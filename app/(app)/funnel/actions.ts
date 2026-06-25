"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, assertCan } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  opportunities,
  accounts,
  persons,
  funnels,
  funnelStages,
  opportunityStageHistory,
  quotations,
  projects,
  member,
  user,
} from "@/db/schema"
import { writeAudit } from "@/server/audit"
import { requestStageAdvance } from "@/server/services/stage"
import { logActivity } from "@/server/services/activity"
import { nextSoNumber } from "@/server/services/numbering"

export type OpportunityListRow = {
  id: string
  name: string
  accountId: string
  accountName: string
  amount: string | null
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
}

export type OpportunityInput = {
  name: string
  accountId: string
  primaryPersonId?: string | null
  funnelId: string
  currentStageId: string
  ownerMemberId: string
  amount?: string | null
  currency: string
  expectedCloseDate?: string | null
}

/** All open + closed opportunities (non-deleted), with denormalized lookups. */
export async function listOpportunities(): Promise<OpportunityListRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx) => {
    const rows = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
        amount: opportunities.amount,
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
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
      .innerJoin(funnelStages, eq(opportunities.currentStageId, funnelStages.id))
      .innerJoin(funnels, eq(opportunities.funnelId, funnels.id))
      .leftJoin(member, eq(opportunities.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(isNull(opportunities.deletedAt))
      .orderBy(desc(opportunities.createdAt))

    return rows.map(({ createdAt: _createdAt, ...r }) => r)
  })
}

export type OpportunityDetail = {
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
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!opp) return null

    const [acct] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, opp.accountId))
      .limit(1)

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
      personName,
      ownerName: owner?.name ?? null,
      stage,
      funnelStagesList,
      quoteNumber,
      amountFromQuote,
      quotations: quotes,
      history,
    }
  })
}

export async function createOpportunity(
  input: OpportunityInput
): Promise<{ id: string }> {
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

      const [row] = await tx
        .insert(opportunities)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          accountId: input.accountId,
          primaryPersonId: input.primaryPersonId || null,
          funnelId: input.funnelId,
          currentStageId: input.currentStageId,
          ownerMemberId: input.ownerMemberId,
          amount: input.amount ? input.amount : null,
          currency: input.currency || "MYR",
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
        valueAtChange: input.amount ? input.amount : null,
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
}

export async function updateOpportunity(
  id: string,
  input: Partial<OpportunityInput>
): Promise<void> {
  await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Funnel not found")

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
        amount:
          input.amount === undefined
            ? existing.amount
            : input.amount
              ? input.amount
              : null,
        currency: input.currency ?? existing.currency,
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
      before: { name: existing.name, amount: existing.amount },
      after: { name: input.name, amount: input.amount },
    })
  })
  revalidatePath("/funnel")
  revalidatePath(`/funnel/${id}`)
}

export async function deleteOpportunity(id: string): Promise<void> {
  await withTenant(PERMISSIONS.OPPORTUNITY_DELETE, async (tx, ctx) => {
    const [existing] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Funnel not found")

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
}

/** All persons with their accountId, for client-side filtering in the form. */
export async function listPersonsWithAccount(): Promise<
  { id: string; name: string; accountId: string }[]
> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx) => {
    const rows = await tx
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        accountId: persons.accountId,
      })
      .from(persons)
      .where(isNull(persons.deletedAt))
      .orderBy(asc(persons.firstName))
    return rows.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
      accountId: p.accountId,
    }))
  })
}

/**
 * Record the Sales Order number for an opportunity. The number is
 * auto-generated per entity ({EntityCode}SO-0001); it is never typed. Per the
 * billing-forecast process, recording an SO requires an attached document
 * (PO / signed-back quotation) — the caller must upload that file before
 * invoking this. Returns the generated SO number.
 */
export async function recordSo(opportunityId: string): Promise<string> {
  return withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
    const [existing] = await tx
      .select({ id: opportunities.id, soNumber: opportunities.soNumber })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, opportunityId),
          isNull(opportunities.deletedAt)
        )
      )
      .limit(1)
    if (!existing) throw new Error("Funnel not found")
    if (existing.soNumber?.trim()) throw new Error("SO already recorded")

    const soNumber = await nextSoNumber(tx, ctx)

    await tx
      .update(opportunities)
      .set({ soNumber, updatedAt: new Date() })
      .where(eq(opportunities.id, opportunityId))

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: opportunityId,
      type: "system",
      subject: `SO recorded: ${soNumber}`,
    })

    await writeAudit(tx, ctx, {
      action: "opportunity.so_recorded",
      entityType: "opportunity",
      entityId: opportunityId,
      after: { soNumber },
    })

    revalidatePath(`/funnel/${opportunityId}`)
    return soNumber
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
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx) => {
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
          isNull(projects.deletedAt)
        )
      )
      .orderBy(desc(projects.createdAt))
  })
}

/** Advance an opportunity's stage. Routes through approval if gated. */
export async function advanceStageAction(input: {
  opportunityId: string
  targetStageId: string
  reason?: string
}): Promise<{ moved: boolean; approvalRequestId?: string }> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.STAGE_ADVANCE)
  const result = await requestStageAdvance(ctx, input)
  revalidatePath("/funnel")
  revalidatePath(`/funnel/${input.opportunityId}`)
  return result
}
