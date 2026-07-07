"use server"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
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
  funnels,
  opportunities,
  accounts,
  persons,
  pipelines,
  pipelineStages,
  funnelStageHistory,
  quotations,
  quotationLineItems,
  products,
  projects,
  member,
  user,
  organization,
  stageApprovalRequests,
  tenantSettings,
  intercompanyDeals,
  intercompanyDealParties,
  intercompanyDealResponses,
} from "@/db/schema"
import type { Tx } from "@/db"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { tenantDefaultCurrency } from "@/server/services/tenant-currency"
import {
  deriveOriginRecognizedPercent,
  validatePartyShares,
  type PartyShare,
} from "@/lib/interco-share"
import { requestStageAdvance, reopenOpportunity } from "@/server/services/stage"
import { isModuleEnabled } from "@/lib/modules"
import {
  createOpportunityContainer,
  recomputeOpportunityTotal,
} from "@/server/services/opportunity-container"
import { pickPpvvc, type Ppvvc } from "@/lib/opportunity-code"
import { runAction, type ActionResult } from "@/lib/action-result"
import { listEntities } from "@/lib/lookups"

export type PartyInput = {
  partnerEntityId: string
  shareType: "percent" | "amount"
  shareValue: string
  /** The party's own invoicing currency. Defaults to the deal currency. */
  currency?: string | null
  /** Deal currency -> party currency rate, manual. Null = same currency. */
  manualFxRate?: string | null
}

export type PartyRow = PartyInput & { partnerName: string }

/**
 * Validate + resolve a deal's full intercompany party list. Each partner MUST
 * be another entity (organization) the caller belongs to — never an external
 * customer account — AND, when the tenant has configured an explicit partner
 * allow-list (Settings), one of the listed entities. Shares are validated
 * together against the deal basis (see lib/interco-share.ts). Returns the
 * resolved rows (with live name snapshots) or [] when the deal isn't
 * intercompany / has no parties.
 */
async function resolvePartyList(
  tx: Tx,
  ctx: { tenantId: string },
  isIntercompany: boolean | undefined,
  parties: PartyInput[] | null | undefined,
  dealBasis: number
): Promise<PartyRow[]> {
  if (!isIntercompany || !parties || parties.length === 0) return []

  const entities = await listEntities()
  const [s] = await tx
    .select({ allowed: tenantSettings.intercompanyPartnerIds })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .limit(1)
  const allowed = s?.allowed ?? null

  const resolved: PartyRow[] = parties.map((p) => {
    const id = (p.partnerEntityId ?? "").trim()
    const match = entities.find((e) => e.id === id)
    if (!match)
      throw new Error(
        "Every handling partner must be one of your own entities, not an external account."
      )
    if (allowed && allowed.length > 0 && !allowed.includes(match.id)) {
      throw new Error(
        `${match.name} is not on your intercompany partner allow-list (Settings → General).`
      )
    }
    return {
      partnerEntityId: match.id,
      partnerName: match.name,
      shareType: p.shareType,
      shareValue: p.shareValue,
      currency: p.currency || null,
      manualFxRate: p.manualFxRate || null,
    }
  })

  const validation = validatePartyShares(
    resolved.map((p) => ({
      partnerEntityId: p.partnerEntityId,
      shareType: p.shareType,
      shareValue: Number(p.shareValue),
    })),
    dealBasis
  )
  if (!validation.ok) throw new Error(validation.error)

  return resolved
}

/** Replace an opportunity's intercompany_deal_parties rows to match `parties`. */
async function saveParties(
  tx: Tx,
  funnelId: string,
  parties: PartyRow[],
  dealCurrency: string
): Promise<void> {
  await tx
    .delete(intercompanyDealParties)
    .where(eq(intercompanyDealParties.funnelId, funnelId))
  if (parties.length === 0) return
  await tx.insert(intercompanyDealParties).values(
    parties.map((p, i) => ({
      funnelId,
      partnerEntityId: p.partnerEntityId,
      shareType: p.shareType,
      shareValue: p.shareValue,
      currency: p.currency || dealCurrency,
      manualFxRate: p.manualFxRate || null,
      sortOrder: i,
    }))
  )
}

/** Server-side range guard for the recognized-% (the client Zod schema alone
 *  is bypassable). Accepts undefined/null/"" (= unset). */
function assertRecognizedPercent(v: string | null | undefined): void {
  if (v === undefined || v === null || v === "") return
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error("Recognized % must be between 0 and 100.")
  }
}

export type OpportunityListRow = {
  id: string
  name: string
  accountId: string
  accountName: string
  /** Quoted amount (synced from the primary quotation), display only. */
  amount: string | null
  /** Estimated Funnel Amount — the deal's headline value; drives the forecast. */
  estimatedAmount: string | null
  /** The origin's own recognized cut (%) — cache: 100 - sum(party shares). */
  recognizedPercent: string | null
  description: string | null
  projectYear: number | null
  isIntercompany: boolean
  /** Handling partners on this deal (0..MAX_INTERCOMPANY_PARTIES). */
  parties: PartyRow[]
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
  pipelineId: string
  pipelineIsDefault: boolean
  primaryQuotationId: string | null
  projectNatureCode: string | null
  projectNatures: string[] | null
  customFields: Record<string, string> | null
}

export type OpportunityInput = {
  name: string
  accountId: string
  primaryPersonId?: string | null
  /** Parent Opportunity container. When omitted, a 1:1 container is auto-created. */
  opportunityId?: string | null
  /** PPVVC analysis — seeds the auto-created container and cascades to the funnel. */
  pain?: string | null
  power?: string | null
  vision?: string | null
  value?: string | null
  control?: string | null
  pipelineId: string
  currentStageId: string
  ownerMemberId: string
  /** Estimated Funnel Amount (manual) — drives the forecast + recognized amount. */
  estimatedAmount?: string | null
  /** Manual recognized % override — ignored/recomputed when isIntercompany + parties are set. */
  recognizedPercent?: string | null
  description?: string | null
  projectYear?: number | null
  isIntercompany?: boolean
  /** Handling partners on this deal (0..MAX_INTERCOMPANY_PARTIES). */
  parties?: PartyInput[] | null
  currency: string
  expectedCloseDate?: string | null
  /** Primary project nature (drives the project code). */
  projectNatureCode?: string | null
  /** Full set of project natures the deal covers (first = primary). */
  projectNatures?: string[] | null
  /** Tenant custom field values, keyed by the field key (cf_…). */
  customFields?: Record<string, string> | null
}

/**
 * Live-resolved party rows for a set of funnels, grouped by
 * funnelId. Entity names resolve LIVE (`organization` is deliberately
 * RLS-excluded, so this sibling-entity join is allowed) so a rename in
 * Settings propagates to every deal that references it.
 */
async function loadPartiesByOpportunity(
  tx: Tx,
  opportunityIds: string[]
): Promise<Map<string, PartyRow[]>> {
  const byOpp = new Map<string, PartyRow[]>()
  if (opportunityIds.length === 0) return byOpp
  const rows = await tx
    .select({
      funnelId: intercompanyDealParties.funnelId,
      partnerEntityId: intercompanyDealParties.partnerEntityId,
      partnerName: organization.name,
      shareType: intercompanyDealParties.shareType,
      shareValue: intercompanyDealParties.shareValue,
      currency: intercompanyDealParties.currency,
      manualFxRate: intercompanyDealParties.manualFxRate,
    })
    .from(intercompanyDealParties)
    .innerJoin(
      organization,
      eq(intercompanyDealParties.partnerEntityId, organization.id)
    )
    .where(inArray(intercompanyDealParties.funnelId, opportunityIds))
    .orderBy(asc(intercompanyDealParties.sortOrder))
  for (const r of rows) {
    const list = byOpp.get(r.funnelId) ?? []
    list.push({
      partnerEntityId: r.partnerEntityId,
      partnerName: r.partnerName,
      shareType: r.shareType,
      shareValue: r.shareValue,
      currency: r.currency,
      manualFxRate: r.manualFxRate,
    })
    byOpp.set(r.funnelId, list)
  }
  return byOpp
}

/** All open + closed funnels (non-deleted), with denormalized lookups. */
export async function listOpportunities(): Promise<OpportunityListRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: funnels.id,
        name: funnels.name,
        accountId: funnels.accountId,
        accountName: accounts.name,
        amount: funnels.amount,
        estimatedAmount: funnels.estimatedAmount,
        recognizedPercent: funnels.recognizedPercent,
        description: funnels.description,
        projectYear: funnels.projectYear,
        isIntercompany: funnels.isIntercompany,
        currency: funnels.currency,
        status: funnels.status,
        expectedCloseDate: funnels.expectedCloseDate,
        ownerMemberId: funnels.ownerMemberId,
        ownerName: user.name,
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
        stageProbability: pipelineStages.probability,
        stageSortOrder: pipelineStages.sortOrder,
        pipelineId: funnels.pipelineId,
        pipelineIsDefault: pipelines.isDefault,
        primaryQuotationId: funnels.primaryQuotationId,
        projectNatureCode: funnels.projectNatureCode,
        projectNatures: funnels.projectNatures,
        customFields: funnels.customFields,
      })
      .from(funnels)
      .innerJoin(accounts, eq(funnels.accountId, accounts.id))
      .innerJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
      .innerJoin(pipelines, eq(funnels.pipelineId, pipelines.id))
      .leftJoin(member, eq(funnels.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(
        and(
          isNull(funnels.deletedAt),
          ownerScope(funnels.ownerMemberId, visible)
        )
      )
      .orderBy(desc(funnels.createdAt))

    const partiesByOpp = await loadPartiesByOpportunity(
      tx,
      rows.map((r) => r.id)
    )
    return rows.map((r) => ({ ...r, parties: partiesByOpp.get(r.id) ?? [] }))
  })
}

export type OpportunityDetail = {
  /** Handling partners on this deal, with live-resolved names. */
  parties: PartyRow[]
  /** Each party's handshake on the assignment, keyed by partnerEntityId. */
  partnerResponses: {
    partnerEntityId: string
    response: "accepted" | "declined"
    reason: string | null
    respondedAt: Date
  }[]
  opportunity: typeof funnels.$inferSelect
  accountName: string
  personName: string | null
  ownerName: string | null
  stage: typeof pipelineStages.$inferSelect
  funnelStagesList: (typeof pipelineStages.$inferSelect)[]
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
      .from(funnels)
      .where(and(eq(funnels.id, id), isNull(funnels.deletedAt)))
      .limit(1)
    if (!opp) return null
    if (!ownsOrManages(visible, opp.ownerMemberId)) return null

    const [acct] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, opp.accountId))
      .limit(1)

    // The handling partners, live-resolved (see loadPartiesByOpportunity).
    const parties = (await loadPartiesByOpportunity(tx, [id])).get(id) ?? []

    // Each party's accept/decline on their slice of the assignment (written by
    // the partner tenant; readable here via the origin-side RLS policy on
    // responses). One intercompanyDeals mirror row per party.
    let partnerResponses: OpportunityDetail["partnerResponses"] = []
    if (opp.isIntercompany) {
      const rows = await tx
        .select({
          partnerEntityId: intercompanyDeals.partnerTenantId,
          response: intercompanyDealResponses.response,
          reason: intercompanyDealResponses.reason,
          respondedAt: intercompanyDealResponses.respondedAt,
        })
        .from(intercompanyDeals)
        .innerJoin(
          intercompanyDealResponses,
          eq(intercompanyDealResponses.dealId, intercompanyDeals.id)
        )
        .where(eq(intercompanyDeals.funnelId, id))
      partnerResponses = rows
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
      .from(pipelineStages)
      .where(eq(pipelineStages.id, opp.currentStageId))
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
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, opp.pipelineId))
      .orderBy(asc(pipelineStages.sortOrder))

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
        and(eq(quotations.funnelId, id), isNull(quotations.deletedAt))
      )
      .orderBy(desc(quotations.version))

    const toStage = alias(pipelineStages, "to_stage")
    const historyRows = await tx
      .select({
        id: funnelStageHistory.id,
        toStageName: toStage.name,
        source: funnelStageHistory.source,
        probabilityAtChange: funnelStageHistory.probabilityAtChange,
        valueAtChange: funnelStageHistory.valueAtChange,
        changedAt: funnelStageHistory.changedAt,
        fromStageId: funnelStageHistory.fromStageId,
        changedByName: user.name,
      })
      .from(funnelStageHistory)
      .innerJoin(toStage, eq(funnelStageHistory.toStageId, toStage.id))
      .leftJoin(
        member,
        eq(funnelStageHistory.changedByMemberId, member.id)
      )
      .leftJoin(user, eq(member.userId, user.id))
      .where(eq(funnelStageHistory.funnelId, id))
      .orderBy(desc(funnelStageHistory.changedAt))

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
          eq(stageApprovalRequests.funnelId, id),
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
      parties,
      partnerResponses,
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
        .from(pipelineStages)
        .where(eq(pipelineStages.id, input.currentStageId))
        .limit(1)
      if (!stage) throw new Error("Invalid stage")
      if (stage.pipelineId !== input.pipelineId)
        throw new Error("Stage does not belong to the selected funnel")

      // owner_member_id is NOT NULL — default to the creator when unspecified.
      const ownerMemberId = input.ownerMemberId || ctx.memberId
      if (!ownerMemberId) throw new Error("No owner for the Funnel")

      assertRecognizedPercent(input.recognizedPercent)
      const dealBasis = Number(input.estimatedAmount ?? 0)
      // Intercompany billing is part of the finance plugin — force it off when
      // that plugin is disabled so no partner rows or mirror are written.
      const wantsInterco =
        isModuleEnabled("finance") && (input.isIntercompany ?? false)
      const parties = await resolvePartyList(
        tx,
        ctx,
        wantsInterco,
        input.parties,
        dealBasis
      )

      // Multi-party interco split: when parties are authored, recognizedPercent
      // is DERIVED as the remainder after every party's share (see
      // lib/interco-share.ts) so the percent-based forecast/displays keep
      // working. Billing later mirrors each party's exact leg. No parties →
      // legacy manual recognizedPercent entry (non-interco deal).
      const recognizedPercentValue = parties.length
        ? (() => {
            const p = deriveOriginRecognizedPercent(
              dealBasis,
              parties.map((pt) => ({
                shareType: pt.shareType,
                shareValue: Number(pt.shareValue),
              }))
            )
            return p != null ? String(p) : null
          })()
        : input.recognizedPercent
          ? input.recognizedPercent
          : null

      const currency =
        input.currency || (await tenantDefaultCurrency(tx, ctx.tenantId))

      // Resolve the parent Opportunity container: use the one passed in (PPVVC
      // cascades DOWN from it), or auto-create a 1:1 container so the single-step
      // "create a funnel" UX keeps working. The funnel's account is inherited
      // from the container (Salesforce "auto-populate funnel account").
      let containerId: string
      let containerAccountId: string
      let ppvvc: Ppvvc
      if (input.opportunityId) {
        const [c] = await tx
          .select()
          .from(opportunities)
          .where(
            and(
              eq(opportunities.id, input.opportunityId),
              isNull(opportunities.deletedAt)
            )
          )
          .limit(1)
        if (!c) throw new Error("Parent opportunity not found")
        containerId = c.id
        containerAccountId = c.accountId
        ppvvc = pickPpvvc(c)
      } else {
        const c = await createOpportunityContainer(tx, ctx, {
          accountId: input.accountId,
          ownerMemberId,
          name: input.name,
          year: input.projectYear,
          currency,
          description: input.description,
          ppvvc: pickPpvvc(input),
          primaryPersonId: input.primaryPersonId,
        })
        containerId = c.id
        containerAccountId = c.accountId
        ppvvc = c.ppvvc
      }

      const [row] = await tx
        .insert(funnels)
        .values({
          tenantId: ctx.tenantId,
          opportunityId: containerId,
          name: input.name,
          accountId: containerAccountId,
          primaryPersonId: input.primaryPersonId || null,
          pipelineId: input.pipelineId,
          currentStageId: input.currentStageId,
          ownerMemberId,
          ...ppvvc,
          // amount stays null on create — it's synced from the primary quote.
          estimatedAmount: input.estimatedAmount ? input.estimatedAmount : null,
          recognizedPercent: recognizedPercentValue,
          description: input.description || null,
          projectYear: input.projectYear ?? null,
          isIntercompany: wantsInterco,
          currency,
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
        .returning({ id: funnels.id })

      if (isModuleEnabled("finance")) {
        await saveParties(tx, row.id, parties, currency)
      }

      // Seed the stage history with the opening stage.
      await tx.insert(funnelStageHistory).values({
        tenantId: ctx.tenantId,
        funnelId: row.id,
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
      await logActivity(tx, ctx, {
        entityType: "opportunity",
        entityId: row.id,
        type: "system",
        subject: "Funnel created",
      })
      // Publish the partner-facing mirror rows (no-op unless intercompany).
      // Loaded lazily so core funnel carries no static dependency on finance.
      if (isModuleEnabled("finance")) {
        const { syncIntercompanyMirror } = await import(
          "@/server/services/intercompany"
        )
        await syncIntercompanyMirror(tx, row.id)
      }
      // Roll the new funnel's estimate up into its container total.
      await recomputeOpportunityTotal(tx, ctx.tenantId, containerId)
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
      .from(funnels)
      .where(and(eq(funnels.id, id), isNull(funnels.deletedAt)))
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

    // Resolve the party list against the effective intercompany flag: a
    // non-intercompany deal clears it; an explicit `parties` array replaces it;
    // otherwise the existing parties are kept (but re-validated against the
    // possibly-changed basis/allow-list).
    // Intercompany billing belongs to the finance plugin — force it off (and
    // clear any parties) when that plugin is disabled.
    const effectiveInterco =
      isModuleEnabled("finance") &&
      (input.isIntercompany === undefined
        ? existing.isIntercompany
        : !!input.isIntercompany)
    assertRecognizedPercent(input.recognizedPercent)
    const nextEstimated =
      input.estimatedAmount === undefined
        ? existing.estimatedAmount
        : input.estimatedAmount || null
    const dealBasis = Number(existing.amount ?? nextEstimated ?? 0)

    let partyInputs: PartyInput[] | null = input.parties ?? null
    if (effectiveInterco && input.parties === undefined) {
      partyInputs = (await loadPartiesByOpportunity(tx, [id])).get(id) ?? []
    }
    const parties = await resolvePartyList(
      tx,
      ctx,
      effectiveInterco,
      partyInputs,
      dealBasis
    )

    // Multi-party interco split (see createOpportunity): recognizedPercent is
    // derived as the remainder after every party's share. Cleared/manual when
    // no longer intercompany.
    const recognizedPercentValue = parties.length
      ? (() => {
          const p = deriveOriginRecognizedPercent(
            dealBasis,
            parties.map((pt) => ({
              shareType: pt.shareType,
              shareValue: Number(pt.shareValue),
            }))
          )
          return p != null ? String(p) : existing.recognizedPercent
        })()
      : input.recognizedPercent === undefined
        ? existing.recognizedPercent
        : input.recognizedPercent || null

    await tx
      .update(funnels)
      .set({
        name: input.name ?? existing.name,
        accountId: input.accountId ?? existing.accountId,
        primaryPersonId:
          input.primaryPersonId === undefined
            ? existing.primaryPersonId
            : input.primaryPersonId || null,
        ownerMemberId: input.ownerMemberId ?? existing.ownerMemberId,
        // amount is quote-derived (never user-edited here).
        estimatedAmount: nextEstimated,
        recognizedPercent: recognizedPercentValue,
        description:
          input.description === undefined
            ? existing.description
            : input.description || null,
        projectYear:
          input.projectYear === undefined
            ? existing.projectYear
            : input.projectYear ?? null,
        isIntercompany: effectiveInterco,
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
      .where(eq(funnels.id, id))

    if (isModuleEnabled("finance")) {
      await saveParties(tx, id, parties, input.currency ?? existing.currency)
    }

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
    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: id,
      type: "system",
      subject: "Funnel updated",
    })
    // Re-publish (or retract, if interco was switched off) the partner mirror.
    if (isModuleEnabled("finance")) {
      const { syncIntercompanyMirror } = await import(
        "@/server/services/intercompany"
      )
      await syncIntercompanyMirror(tx, id)
    }
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
        id: funnels.id,
        ownerMemberId: funnels.ownerMemberId,
      })
      .from(funnels)
      .where(and(eq(funnels.id, id), isNull(funnels.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this Funnel")

    await tx
      .update(funnels)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(funnels.id, id))

    await writeAudit(tx, ctx, {
      action: "opportunity.deleted",
      entityType: "opportunity",
      entityId: id,
    })
    // A deleted deal must disappear from the partner's inbound list too.
    if (isModuleEnabled("finance")) {
      const { syncIntercompanyMirror } = await import(
        "@/server/services/intercompany"
      )
      await syncIntercompanyMirror(tx, id)
    }
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
  funnelId: string
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
          eq(projects.funnelId, funnelId),
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
  funnelId: string
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
          eq(quotations.funnelId, funnelId),
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
  funnelId: string
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
      .select({ ownerMemberId: funnels.ownerMemberId })
      .from(funnels)
      .where(
        and(
          eq(funnels.id, input.funnelId),
          isNull(funnels.deletedAt)
        )
      )
      .limit(1)
    if (!opp) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this Funnel")
  })
  const result = await requestStageAdvance(ctx, input)
  revalidatePath("/funnel")
  revalidatePath(`/funnel/${input.funnelId}`)
  return result
  })
}

/**
 * Reopen a parked (KIV) or lost opportunity into a chosen OPEN stage, clearing
 * the close timestamp/date and resetting status. Same permission + record scope
 * as advancing; the terminal-state rules themselves are enforced in the service.
 */
export async function reopenStageAction(input: {
  funnelId: string
  targetStageId: string
  reason?: string
}): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.STAGE_ADVANCE)
    await runInTenant(ctx.tenantId, async (tx) => {
      const visible = await visibleMemberIds(tx, ctx)
      const [opp] = await tx
        .select({ ownerMemberId: funnels.ownerMemberId })
        .from(funnels)
        .where(
          and(
            eq(funnels.id, input.funnelId),
            isNull(funnels.deletedAt)
          )
        )
        .limit(1)
      if (!opp) throw new Error("Funnel not found")
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this Funnel")
    })
    await reopenOpportunity(ctx, input)
    revalidatePath("/funnel")
    revalidatePath(`/funnel/${input.funnelId}`)
  })
}
