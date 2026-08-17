"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
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
  pipelineStages,
  funnelStageHistory,
  quotations,
  quotationLineItems,
  products,
  projects,
  intercompanyDealParties,
  tenantSettings,
} from "@/db/schema"
import type { Tx } from "@/db"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { recordChanges } from "@/server/services/changes/record"
import {
  assertCurrencyLock,
  tenantCurrencyForRecord,
} from "@/server/services/tenant-currency"
import {
  deriveOriginRecognizedPercent,
  validatePartyShares,
} from "@/lib/interco-share"
import { requestStageAdvance, reopenOpportunity } from "@/server/services/stage"
import { getEntitledModuleMap } from "@/lib/modules.server"
import {
  createOpportunityContainer,
  recomputeOpportunityTotal,
  pickNature,
} from "@/server/services/opportunity-container"
import { pickPpvvc, type Ppvvc } from "@/lib/opportunity-code"
import { updateFunnelPpvvc } from "@/server/services/ppvvc"
import { runAction, type ActionResult } from "@/lib/action-result"
import { listEntities } from "@/lib/lookups"
import {
  normalizeDateInput,
  normalizeMoneyInput,
  normalizeCustomFieldValue,
  normalizeYearInput,
  isValidPercentInput,
} from "@/lib/input-validation"
import { type CustomFunnelField } from "@/lib/stage-gate"
import {
  funnelsList,
  funnelsGet,
  loadPartiesByOpportunity,
  type PartyRow,
} from "@/lib/api-readers"

export type PartyInput = {
  partnerEntityId: string
  shareType: "percent" | "amount"
  shareValue: string
  /** The party's own invoicing currency. Defaults to the deal currency. */
  currency?: string | null
  /** Deal currency -> party currency rate, manual. Null = same currency. */
  manualFxRate?: string | null
}

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
    const normalizedShareValue = normalizeMoneyInput(p.shareValue, "Partner share value")
    if (normalizedShareValue === null) {
      throw new Error("Handling partner share value is required.")
    }
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
      shareValue: normalizedShareValue,
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

async function loadCustomFunnelFieldDefs(
  tx: Tx,
  tenantId: string
): Promise<CustomFunnelField[]> {
  const [row] = await tx
    .select({ customFunnelFields: tenantSettings.customFunnelFields })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  return row?.customFunnelFields ?? []
}

function normalizeOpportunityCustomFields(
  customFields: Record<string, string> | null | undefined,
  defs: CustomFunnelField[]
): Record<string, string> {
  if (!customFields) return {}
  const byKey = new Map(defs.map((f) => [f.key, f]))
  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(customFields)) {
    const def = byKey.get(key)
    if (!def) continue
    const type = def.type ?? "text"
    const options = type === "select" ? def.options ?? [] : []
    normalized[key] = normalizeCustomFieldValue(
      rawValue,
      type,
      options,
      `${def.label} (${key})`
    )
  }
  return normalized
}

/** Server-side range guard for the recognized-% (the client Zod schema alone
 *  is bypassable). Accepts undefined/null/"" (= unset). */
function assertRecognizedPercent(v: string | null | undefined): void {
  if (v === undefined || v === null || v === "") return
  if (!isValidPercentInput(v)) {
    throw new Error("Recognized % must be between 0 and 100.")
  }
}

export type OpportunityListRow = {
  id: string
  opportunityId: string
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
  pain: string | null
  power: string | null
  vision: string | null
  value: string | null
  control: string | null
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
  /** Commit (4A) gate fields — see the SF Sales_Stage_to_4A validation rule. */
  procurementStage?: string | null
  negotiationDone?: boolean
  negotiationDate?: string | null
  expectedInvoiceMonth?: string | null
  expectedInvoiceYear?: number | null
}

// loadPartiesByOpportunity now lives in @/lib/api-readers (shared with the
// funnels reader) and is imported above; it's still used by the mutation
// actions below (createOpportunity / updateOpportunity).

// The original query had no .limit() — every visible funnel was returned.
// Preserve that by passing an effectively-unbounded page to the shared reader.
const UNBOUNDED_LIMIT = 1_000_000

/** All open + closed funnels (non-deleted), with denormalized lookups. */
export async function listOpportunities(): Promise<OpportunityListRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const { rows } = await funnelsList(tx, ctx, { limit: UNBOUNDED_LIMIT, offset: 0 })
    return rows
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
  /** Parent Opportunity container (full row — SF-parity gate fields included). */
  container: typeof opportunities.$inferSelect | null
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
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, (tx, ctx) => funnelsGet(tx, ctx, id))
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

      // SF "Only_0E_During_Funnel_Creation": a new funnel must start at its
      // pipeline's first OPEN-kind stage — can't be created directly at a
      // later stage (or a terminal one).
      const [firstOpenStage] = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(
          and(eq(pipelineStages.pipelineId, input.pipelineId), eq(pipelineStages.kind, "OPEN"))
        )
        .orderBy(asc(pipelineStages.sortOrder))
        .limit(1)
      if (!firstOpenStage || firstOpenStage.id !== stage.id)
        throw new Error("A new Funnel must start at its pipeline's first stage.")

      // owner_member_id is NOT NULL — default to the creator when unspecified.
      const ownerMemberId = input.ownerMemberId || ctx.memberId
      if (!ownerMemberId) throw new Error("No owner for the Funnel")

      const estimatedAmount = normalizeMoneyInput(input.estimatedAmount, "Estimated funnel amount")
      const expectedCloseDate = normalizeDateInput(
        input.expectedCloseDate,
        "Expected close date"
      )
      const projectYear = normalizeYearInput(input.projectYear, "Project / license year")
      assertRecognizedPercent(input.recognizedPercent)
      const dealBasis = Number(estimatedAmount ?? 0)
      // Intercompany billing is part of the finance plugin — force it off when
      // that plugin is disabled so no partner rows or mirror are written.
      const wantsInterco =
        (await getEntitledModuleMap()).finance && (input.isIntercompany ?? false)
      const parties = await resolvePartyList(
        tx,
        ctx,
        wantsInterco,
        input.parties,
        dealBasis
      )
      const customFieldDefs = await loadCustomFunnelFieldDefs(
        tx,
        ctx.tenantId
      )
      const customFields = normalizeOpportunityCustomFields(
        input.customFields,
        customFieldDefs
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

      // Resolve the parent Opportunity container: use the one passed in (PPVVC
      // cascades DOWN from it), or auto-create a 1:1 container so the single-step
      // "create a funnel" UX keeps working. The funnel's account is inherited
      // from the container (Salesforce "auto-populate funnel account").
      let containerId = ""
      let containerAccountId = input.accountId
      let ppvvc: Ppvvc
      let nature: { projectNatureCode: string | null; projectNatures: string[] | null }
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
        nature = pickNature(c)
      } else {
        ppvvc = pickPpvvc(input)
        nature = pickNature(input)
      }
      const [account] = await tx
        .select({ currency: accounts.currency })
        .from(accounts)
        .where(eq(accounts.id, containerAccountId))
        .limit(1)
      const currency = await tenantCurrencyForRecord(
        tx,
        ctx.tenantId,
        input.currency,
        account?.currency
      )
      if (!input.opportunityId) {
        const c = await createOpportunityContainer(tx, ctx, {
          accountId: containerAccountId,
          ownerMemberId,
          name: input.name,
          year: projectYear,
          currency,
          description: input.description,
          ppvvc,
          primaryPersonId: input.primaryPersonId,
          projectNatureCode: input.projectNatures?.[0] ?? input.projectNatureCode ?? null,
          projectNatures: input.projectNatures ?? null,
        })
        containerId = c.id
        ppvvc = c.ppvvc
        nature = c.nature
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
          estimatedAmount,
          recognizedPercent: recognizedPercentValue,
          description: input.description || null,
          projectYear,
          isIntercompany: wantsInterco,
          currency,
          // Cascaded from the container (source of truth) — same pattern as PPVVC.
          ...nature,
          customFields,
          expectedCloseDate,
        })
        .returning({ id: funnels.id })

      if ((await getEntitledModuleMap()).finance) {
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
        valueAtChange: estimatedAmount,
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
      if ((await getEntitledModuleMap()).finance) {
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
    const resolvedCurrency = await tenantCurrencyForRecord(
      tx,
      ctx.tenantId,
      input.currency,
      existing.currency
    )

    // The primary quotation freezes its currency at creation and is never
    // re-snapshotted, so a divergent opportunity currency would have the same
    // money reported under two currencies (and re-denominated with no FX in the
    // forecast/pipeline views). Reject a currency change while a differing,
    // non-deleted primary quotation exists.
    if (existing.primaryQuotationId) {
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
      assertCurrencyLock(resolvedCurrency, existing.currency, pq?.currency)
    }

    // Resolve the party list against the effective intercompany flag: a
    // non-intercompany deal clears it; an explicit `parties` array replaces it;
    // otherwise the existing parties are kept (but re-validated against the
    // possibly-changed basis/allow-list).
    // Intercompany billing belongs to the finance plugin — force it off (and
    // clear any parties) when that plugin is disabled.
    const effectiveInterco =
      (await getEntitledModuleMap()).finance &&
      (input.isIntercompany === undefined
        ? existing.isIntercompany
        : !!input.isIntercompany)
    const nextEstimated =
      input.estimatedAmount === undefined
        ? existing.estimatedAmount
        : normalizeMoneyInput(input.estimatedAmount, "Estimated funnel amount")
    assertRecognizedPercent(input.recognizedPercent)
    const dealBasis = Number(existing.amount ?? nextEstimated ?? 0)
    const expectedCloseDate =
      input.expectedCloseDate === undefined
        ? undefined
        : normalizeDateInput(input.expectedCloseDate, "Expected close date")
    const projectYear =
      input.projectYear === undefined
        ? undefined
        : normalizeYearInput(input.projectYear, "Project / license year")
    const customFieldDefs = await loadCustomFunnelFieldDefs(tx, ctx.tenantId)
    const customFields =
      input.customFields === undefined
        ? existing.customFields
        : normalizeOpportunityCustomFields(input.customFields, customFieldDefs)

    const ppvvcInput = {
      pain: input.pain,
      power: input.power,
      vision: input.vision,
      value: input.value,
      control: input.control,
    }
    const hasPpvvcInput = Object.values(ppvvcInput).some(
      (value) => value !== undefined
    )

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

    const updated = {
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
          : projectYear,
      isIntercompany: effectiveInterco,
      currency: resolvedCurrency,
      projectNatures:
        input.projectNatures === undefined
          ? existing.projectNatures
          : input.projectNatures && input.projectNatures.length
            ? input.projectNatures
            : null,
      customFields:
        input.customFields === undefined
          ? existing.customFields
          : customFields,
      projectNatureCode:
        input.projectNatures !== undefined
          ? input.projectNatures?.[0] ?? null
          : input.projectNatureCode === undefined
            ? existing.projectNatureCode
            : input.projectNatureCode || null,
      expectedCloseDate:
        input.expectedCloseDate === undefined
          ? existing.expectedCloseDate
          : expectedCloseDate,
      procurementStage:
        input.procurementStage === undefined
          ? existing.procurementStage
          : input.procurementStage || null,
      negotiationDone: input.negotiationDone ?? existing.negotiationDone,
      negotiationDate:
        input.negotiationDate === undefined
          ? existing.negotiationDate
          : input.negotiationDate || null,
      expectedInvoiceMonth:
        input.expectedInvoiceMonth === undefined
          ? existing.expectedInvoiceMonth
          : input.expectedInvoiceMonth || null,
      expectedInvoiceYear:
        input.expectedInvoiceYear === undefined
          ? existing.expectedInvoiceYear
          : input.expectedInvoiceYear ?? null,
      updatedAt: new Date(),
    }

    const syncedPpvvc = hasPpvvcInput
      ? await updateFunnelPpvvc(tx, {
          funnelId: id,
          values: ppvvcInput,
          actorId: ctx.userId,
        })
      : null

    await tx.update(funnels).set(updated).where(eq(funnels.id, id))

    // estimatedAmount may have changed → refresh the parent container's rollup.
    await recomputeOpportunityTotal(tx, ctx.tenantId, existing.opportunityId)

    if ((await getEntitledModuleMap()).finance) {
      await saveParties(tx, id, parties, resolvedCurrency)
    }

    await recordChanges(tx, ctx, {
      entityType: "opportunity",
      registryKey: "funnel",
      entityId: id,
      before: existing,
      after: {
        ...existing,
        ...updated,
        ...(syncedPpvvc?.after ?? {}),
      },
      subject: "Funnel updated",
    })
    // Re-publish (or retract, if interco was switched off) the partner mirror.
    if ((await getEntitledModuleMap()).finance) {
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
        opportunityId: funnels.opportunityId,
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

    // Removing a funnel changes its container's rollup.
    await recomputeOpportunityTotal(tx, ctx.tenantId, existing.opportunityId)

    await writeAudit(tx, ctx, {
      action: "opportunity.deleted",
      entityType: "opportunity",
      entityId: id,
    })
    // A deleted deal must disappear from the partner's inbound list too.
    if ((await getEntitledModuleMap()).finance) {
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
  { id: string; name: string; accountId: string; designation: string | null; department: string | null }[]
> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
        accountId: persons.accountId,
        designation: persons.title,
        department: persons.department,
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
      designation: p.designation ?? null,
      department: p.department ?? null,
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
  if (!(await getEntitledModuleMap()).projects) return []
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
