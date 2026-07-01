"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, assertCan } from "@/lib/actions"
import { runInTenant } from "@/db"
import { PERMISSIONS } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import {
  opportunities,
  accounts,
  persons,
  funnels,
  funnelStages,
  opportunityStageHistory,
  quotations,
  quotationLineItems,
  products,
  projects,
  member,
  user,
  stageApprovalRequests,
} from "@/db/schema"
import { writeAudit } from "@/server/audit"
import { requestStageAdvance, reopenOpportunity } from "@/server/services/stage"
import { runAction, type ActionResult } from "@/lib/action-result"

export type OpportunityListRow = {
  id: string
  name: string
  accountId: string
  accountName: string
  /** Quoted amount (synced from the primary quotation), display only. */
  amount: string | null
  /** Estimated Funnel Amount — the deal's headline value; drives the forecast. */
  estimatedAmount: string | null
  recognizedPercent: string | null
  description: string | null
  projectYear: number | null
  isIntercompany: boolean
  handlingPartnerAccountId: string | null
  currency: string
  status: string
  expectedCloseDate: string | null
  ownerMemberId: string
  ownerName: string | null
  stageId: string
  stageName: string
  stageKind: string
  stageProbability: string
  stageSortOrder: number
  funnelId: string
  funnelIsDefault: boolean
  primaryQuotationId: string | null
  projectNatureCode: string | null
  projectNatures: string[] | null
  customFields: Record<string, string> | null
}

export type OpportunityInput = {
  name: string
  accountId: string
  primaryPersonId?: string | null
  funnelId: string
  currentStageId: string
  ownerMemberId: string
  /** Estimated Funnel Amount (manual) — drives the forecast + recognized amount. */
  estimatedAmount?: string | null
  recognizedPercent?: string | null
  description?: string | null
  projectYear?: number | null
  isIntercompany?: boolean
  /** Partner account that handles delivery on an interco deal. */
  handlingPartnerAccountId?: string | null
  currency: string
  expectedCloseDate?: string | null
  /** Primary project nature (drives the project code). */
  projectNatureCode?: string | null
  /** Full set of project natures the deal covers (first = primary). */
  projectNatures?: string[] | null
  /** Tenant custom field values, keyed by the field key (cf_…). */
  customFields?: Record<string, string> | null
}

/** All open + closed opportunities (non-deleted), with denormalized lookups. */
export async function listOpportunities(): Promise<OpportunityListRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
        amount: opportunities.amount,
        estimatedAmount: opportunities.estimatedAmount,
        recognizedPercent: opportunities.recognizedPercent,
        description: opportunities.description,
        projectYear: opportunities.projectYear,
        isIntercompany: opportunities.isIntercompany,
        handlingPartnerAccountId: opportunities.handlingPartnerAccountId,
        currency: opportunities.currency,
        status: opportunities.status,
        expectedCloseDate: opportunities.expectedCloseDate,
        ownerMemberId: opportunities.ownerMemberId,
        ownerName: user.name,
        stageId: funnelStages.id,
        stageName: funnelStages.name,
        stageKind: funnelStages.kind,
        stageProbability: funnelStages.probability,
        stageSortOrder: funnelStages.sortOrder,
        funnelId: opportunities.funnelId,
        funnelIsDefault: funnels.isDefault,
        primaryQuotationId: opportunities.primaryQuotationId,
        projectNatureCode: opportunities.projectNatureCode,
        projectNatures: opportunities.projectNatures,
        customFields: opportunities.customFields,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
      .innerJoin(funnelStages, eq(opportunities.currentStageId, funnelStages.id))
      .innerJoin(funnels, eq(opportunities.funnelId, funnels.id))
      .leftJoin(member, eq(opportunities.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(
        and(
          isNull(opportunities.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(desc(opportunities.createdAt))

    return rows
  })
}

export type OpportunityDetail = {
  handlingPartnerName: string | null
  opportunity: typeof opportunities.$inferSelect
  accountName: string
  personName: string | null
  ownerName: string | null
  stage: typeof funnelStages.$inferSelect
  funnelStagesList: (typeof funnelStages.$inferSelect)[]
  /** Quote number of the primary quotation, if the amount derives from one. */
  quoteNumber: string | null
  /** True when opportunity.amount is synced from a primary quotation (net). */
  amountFromQuote: boolean
  /** A pending stage-advance approval for this opportunity, if one is in flight. */
  pendingApproval: { id: string; targetStageName: string } | null
  quotations: {
    id: string
    quoteNumber: string
    status: string
    total: string
    currency: string
    isPrimary: boolean
  }[]
  history: {
    id: string
    fromStageName: string | null
    toStageName: string
    source: string
    probabilityAtChange: string | null
    valueAtChange: string | null
    changedAt: Date
    changedByName: string | null
  }[]
}

/** Full detail for one opportunity: stage, lookups, quotations, history. */
export async function getOpportunity(
  id: string
): Promise<OpportunityDetail | null> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!opp) return null
    if (!ownsOrManages(visible, opp.ownerMemberId)) return null

    const [acct] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, opp.accountId))
      .limit(1)

    let handlingPartnerName: string | null = null
    if (opp.handlingPartnerAccountId) {
      const [hp] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, opp.handlingPartnerAccountId))
        .limit(1)
      handlingPartnerName = hp?.name ?? null
    }

    let personName: string | null = null
    if (opp.primaryPersonId) {
      const [p] = await tx
        .select({ firstName: persons.firstName, lastName: persons.lastName })
        .from(persons)
        .where(eq(persons.id, opp.primaryPersonId))
        .limit(1)
      if (p) personName = [p.firstName, p.lastName].filter(Boolean).join(" ")
    }

    const [owner] = await tx
      .select({ name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.id, opp.ownerMemberId))
      .limit(1)

    const [stage] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, opp.currentStageId))
      .limit(1)

    // Resolve the primary quotation's number so the summary can show that the
    // net deal value derives "from quotation <quoteNumber>".
    let quoteNumber: string | null = null
    if (opp.primaryQuotationId) {
      const [pq] = await tx
        .select({ quoteNumber: quotations.quoteNumber })
        .from(quotations)
        .where(eq(quotations.id, opp.primaryQuotationId))
        .limit(1)
      quoteNumber = pq?.quoteNumber ?? null
    }
    const amountFromQuote = quoteNumber !== null

    const funnelStagesList = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.funnelId, opp.funnelId))
      .orderBy(asc(funnelStages.sortOrder))

    const quotes = await tx
      .select({
        id: quotations.id,
        quoteNumber: quotations.quoteNumber,
        status: quotations.status,
        total: quotations.total,
        currency: quotations.currency,
        isPrimary: quotations.isPrimary,
      })
      .from(quotations)
      .where(
        and(eq(quotations.opportunityId, id), isNull(quotations.deletedAt))
      )
      .orderBy(desc(quotations.version))

    const toStage = alias(funnelStages, "to_stage")
    const historyRows = await tx
      .select({
        id: opportunityStageHistory.id,
        toStageName: toStage.name,
        source: opportunityStageHistory.source,
        probabilityAtChange: opportunityStageHistory.probabilityAtChange,
        valueAtChange: opportunityStageHistory.valueAtChange,
        changedAt: opportunityStageHistory.changedAt,
        fromStageId: opportunityStageHistory.fromStageId,
        changedByName: user.name,
      })
      .from(opportunityStageHistory)
      .innerJoin(toStage, eq(opportunityStageHistory.toStageId, toStage.id))
      .leftJoin(
        member,
        eq(opportunityStageHistory.changedByMemberId, member.id)
      )
      .leftJoin(user, eq(member.userId, user.id))
      .where(eq(opportunityStageHistory.opportunityId, id))
      .orderBy(desc(opportunityStageHistory.changedAt))

    // Resolve fromStage names with a single lookup map.
    const stageNameById = new Map(
      funnelStagesList.map((s) => [s.id, s.name])
    )

    // A pending approval freezes the funnel CTA on the detail page so the
    // requester sees the in-flight state instead of a still-active Advance.
    const [pending] = await tx
      .select({
        id: stageApprovalRequests.id,
        targetStageId: stageApprovalRequests.targetStageId,
      })
      .from(stageApprovalRequests)
      .where(
        and(
          eq(stageApprovalRequests.opportunityId, id),
          eq(stageApprovalRequests.status, "pending")
        )
      )
      .limit(1)
    const pendingApproval = pending
      ? {
          id: pending.id,
          targetStageName: stageNameById.get(pending.targetStageId) ?? "—",
        }
      : null

    const history = historyRows.map((h) => ({
      id: h.id,
      fromStageName: h.fromStageId
        ? stageNameById.get(h.fromStageId) ?? null
        : null,
      toStageName: h.toStageName,
      source: h.source,
      probabilityAtChange: h.probabilityAtChange,
      valueAtChange: h.valueAtChange,
      changedAt: h.changedAt,
      changedByName: h.changedByName,
    }))

    return {
      opportunity: opp,
      accountName: acct?.name ?? "—",
      handlingPartnerName,
      personName,
      ownerName: owner?.name ?? null,
      stage,
      funnelStagesList,
      quoteNumber,
      amountFromQuote,
      pendingApproval,
      quotations: quotes,
      history,
    }
  })
}

export async function createOpportunity(
  input: OpportunityInput
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
  const created = await withTenant(
    PERMISSIONS.OPPORTUNITY_CREATE,
    async (tx, ctx) => {
      const [stage] = await tx
        .select()
        .from(funnelStages)
        .where(eq(funnelStages.id, input.currentStageId))
        .limit(1)
      if (!stage) throw new Error("Invalid stage")
      if (stage.funnelId !== input.funnelId)
        throw new Error("Stage does not belong to the selected funnel")

      // owner_member_id is NOT NULL — default to the creator when unspecified.
      const ownerMemberId = input.ownerMemberId || ctx.memberId
      if (!ownerMemberId) throw new Error("No owner for the Funnel")

      const [row] = await tx
        .insert(opportunities)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          accountId: input.accountId,
          primaryPersonId: input.primaryPersonId || null,
          funnelId: input.funnelId,
          currentStageId: input.currentStageId,
          ownerMemberId,
          // amount stays null on create — it's synced from the primary quote.
          estimatedAmount: input.estimatedAmount ? input.estimatedAmount : null,
          recognizedPercent: input.recognizedPercent
            ? input.recognizedPercent
            : null,
          description: input.description || null,
          projectYear: input.projectYear ?? null,
          isIntercompany: input.isIntercompany ?? false,
          handlingPartnerAccountId: input.handlingPartnerAccountId || null,
          currency: input.currency || "MYR",
          // Primary nature = first of the set (falls back to the single field).
          projectNatureCode:
            input.projectNatures?.[0] ?? input.projectNatureCode ?? null,
          projectNatures:
            input.projectNatures && input.projectNatures.length
              ? input.projectNatures
              : null,
          customFields: input.customFields ?? {},
          expectedCloseDate: input.expectedCloseDate || null,
        })
        .returning({ id: opportunities.id })

      // Seed the stage history with the opening stage.
      await tx.insert(opportunityStageHistory).values({
        tenantId: ctx.tenantId,
        opportunityId: row.id,
        fromStageId: null,
        toStageId: stage.id,
        changedByMemberId: ctx.memberId,
        probabilityAtChange: stage.probability,
        valueAtChange: input.estimatedAmount ? input.estimatedAmount : null,
        source: "manual",
      })

      await writeAudit(tx, ctx, {
        action: "opportunity.created",
        entityType: "opportunity",
        entityId: row.id,
        after: { name: input.name },
      })
      return row
    }
  )
  revalidatePath("/funnel")
  return created
  })
}

export async function updateOpportunity(
  id: string,
  input: Partial<OpportunityInput>
): Promise<ActionResult> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [existing] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this Funnel")

    // The primary quotation freezes its currency at creation and is never
    // re-snapshotted, so a divergent opportunity currency would have the same
    // money reported under two currencies (and re-denominated with no FX in the
    // forecast/pipeline views). Reject a currency change while a differing,
    // non-deleted primary quotation exists.
    if (
      input.currency !== undefined &&
      input.currency !== existing.currency &&
      existing.primaryQuotationId
    ) {
      const [pq] = await tx
        .select({ currency: quotations.currency })
        .from(quotations)
        .where(
          and(
            eq(quotations.id, existing.primaryQuotationId),
            isNull(quotations.deletedAt)
          )
        )
        .limit(1)
      if (pq && pq.currency !== input.currency)
        throw new Error(
          "Currency is locked while a primary quotation exists. Remove or replace the primary quotation to change it."
        )
    }

    await tx
      .update(opportunities)
      .set({
        name: input.name ?? existing.name,
        accountId: input.accountId ?? existing.accountId,
        primaryPersonId:
          input.primaryPersonId === undefined
            ? existing.primaryPersonId
            : input.primaryPersonId || null,
        ownerMemberId: input.ownerMemberId ?? existing.ownerMemberId,
        // amount is quote-derived (never user-edited here).
        estimatedAmount:
          input.estimatedAmount === undefined
            ? existing.estimatedAmount
            : input.estimatedAmount || null,
        recognizedPercent:
          input.recognizedPercent === undefined
            ? existing.recognizedPercent
            : input.recognizedPercent || null,
        description:
          input.description === undefined
            ? existing.description
            : input.description || null,
        projectYear:
          input.projectYear === undefined
            ? existing.projectYear
            : input.projectYear ?? null,
        isIntercompany:
          input.isIntercompany === undefined
            ? existing.isIntercompany
            : !!input.isIntercompany,
        handlingPartnerAccountId:
          input.handlingPartnerAccountId === undefined
            ? existing.handlingPartnerAccountId
            : input.handlingPartnerAccountId || null,
        currency: input.currency ?? existing.currency,
        projectNatures:
          input.projectNatures === undefined
            ? existing.projectNatures
            : input.projectNatures && input.projectNatures.length
              ? input.projectNatures
              : null,
        customFields:
          input.customFields === undefined
            ? existing.customFields
            : input.customFields ?? {},
        projectNatureCode:
          input.projectNatures !== undefined
            ? input.projectNatures?.[0] ?? null
            : input.projectNatureCode === undefined
              ? existing.projectNatureCode
              : input.projectNatureCode || null,
        expectedCloseDate:
          input.expectedCloseDate === undefined
            ? existing.expectedCloseDate
            : input.expectedCloseDate || null,
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, id))

    await writeAudit(tx, ctx, {
      action: "opportunity.updated",
      entityType: "opportunity",
      entityId: id,
      before: {
        name: existing.name,
        estimatedAmount: existing.estimatedAmount,
      },
      after: { name: input.name, estimatedAmount: input.estimatedAmount },
    })
  })
  revalidatePath("/funnel")
  revalidatePath(`/funnel/${id}`)
  })
}

export async function deleteOpportunity(id: string): Promise<ActionResult> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.OPPORTUNITY_DELETE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [existing] = await tx
      .select({
        id: opportunities.id,
        ownerMemberId: opportunities.ownerMemberId,
      })
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this Funnel")

    await tx
      .update(opportunities)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(opportunities.id, id))

    await writeAudit(tx, ctx, {
      action: "opportunity.deleted",
      entityType: "opportunity",
      entityId: id,
    })
  })
  revalidatePath("/funnel")
  })
}

/** All persons with their accountId, for client-side filtering in the form. */
export async function listPersonsWithAccount(): Promise<
  { id: string; name: string; accountId: string }[]
> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        accountId: persons.accountId,
      })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(
        and(
          isNull(persons.deletedAt),
          ownerScope(accounts.ownerMemberId, visible)
        )
      )
      .orderBy(asc(persons.firstName))
    return rows.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      accountId: p.accountId,
    }))
  })
}

export type OpportunityProjectRow = {
  id: string
  projectCode: string
  name: string
  status: string
}

/** Delivery projects created from this opportunity (non-deleted). */
export async function listOpportunityProjects(
  opportunityId: string
): Promise<OpportunityProjectRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: projects.id,
        projectCode: projects.projectCode,
        name: projects.name,
        status: projects.status,
      })
      .from(projects)
      .where(
        and(
          eq(projects.opportunityId, opportunityId),
          isNull(projects.deletedAt),
          ownerScope(projects.ownerMemberId, visible)
        )
      )
      .orderBy(desc(projects.createdAt))
  })
}

export type OpportunityProductRow = {
  productId: string
  name: string
  productCode: string | null
  uom: string | null
  /** Number of (non-deleted) quotations of this funnel that include the product. */
  quoteCount: number
}

/**
 * Distinct standardised products offered across this funnel's non-deleted
 * quotations (via their line items). Lets the funnel detail show "which product
 * is being offered" without opening each quote.
 */
export async function listOpportunityProducts(
  opportunityId: string
): Promise<OpportunityProductRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx) => {
    const rows = await tx
      .select({
        productId: products.id,
        name: products.name,
        productCode: products.productCode,
        uom: products.uom,
        quotationId: quotations.id,
      })
      .from(quotationLineItems)
      .innerJoin(
        quotations,
        eq(quotationLineItems.quotationId, quotations.id)
      )
      .innerJoin(products, eq(quotationLineItems.productId, products.id))
      .where(
        and(
          eq(quotations.opportunityId, opportunityId),
          isNull(quotations.deletedAt)
        )
      )

    // Collapse to one row per product, counting the distinct quotes it appears on.
    const byProduct = new Map<string, OpportunityProductRow & { quotes: Set<string> }>()
    for (const r of rows) {
      let entry = byProduct.get(r.productId)
      if (!entry) {
        entry = {
          productId: r.productId,
          name: r.name,
          productCode: r.productCode,
          uom: r.uom,
          quoteCount: 0,
          quotes: new Set<string>(),
        }
        byProduct.set(r.productId, entry)
      }
      entry.quotes.add(r.quotationId)
    }
    return [...byProduct.values()]
      .map(({ quotes, ...p }) => ({ ...p, quoteCount: quotes.size }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

/** Advance an opportunity's stage. Routes through approval if gated. */
export async function advanceStageAction(input: {
  opportunityId: string
  targetStageId: string
  reason?: string
  customFields?: Record<string, string>
}): Promise<ActionResult<{ moved: boolean; approvalRequestId?: string }>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.STAGE_ADVANCE)
  await runInTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({ ownerMemberId: opportunities.ownerMemberId })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, input.opportunityId),
          isNull(opportunities.deletedAt)
        )
      )
      .limit(1)
    if (!opp) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this Funnel")
  })
  const result = await requestStageAdvance(ctx, input)
  revalidatePath("/funnel")
  revalidatePath(`/funnel/${input.opportunityId}`)
  return result
  })
}

/**
 * Reopen a parked (KIV) or lost opportunity into a chosen OPEN stage, clearing
 * the close timestamp/date and resetting status. Same permission + record scope
 * as advancing; the terminal-state rules themselves are enforced in the service.
 */
export async function reopenStageAction(input: {
  opportunityId: string
  targetStageId: string
  reason?: string
}): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.STAGE_ADVANCE)
    await runInTenant(ctx.tenantId, async (tx) => {
      const visible = await visibleMemberIds(tx, ctx)
      const [opp] = await tx
        .select({ ownerMemberId: opportunities.ownerMemberId })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, input.opportunityId),
            isNull(opportunities.deletedAt)
          )
        )
        .limit(1)
      if (!opp) throw new Error("Funnel not found")
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this Funnel")
    })
    await reopenOpportunity(ctx, input)
    revalidatePath("/funnel")
    revalidatePath(`/funnel/${input.opportunityId}`)
  })
}
