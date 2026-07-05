"use server"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { runInTenant } from "@/db"
import { requireContext, assertCan } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { visibleMemberIds, canManageAllRecords } from "@/lib/access-scope"
import { intercompanyDeals, organization, tenantSettings } from "@/db/schema"
import { partyShare } from "@/lib/interco-share"

/** One row of the weighted billing forecast (per OPEN opportunity). */
export type ForecastRow = {
  opportunityId: string
  opportunityName: string
  accountId: string | null
  ownerMemberId: string | null
  funnelId: string | null
  stageCode: string | null
  stageName: string | null
  probability: string | null
  currency: string | null
  expectedCloseDate: string | null
  forecastMonth: string | null
  opportunityValue: string
  weightedValue: string
  /** The tenant's cut on an intercompany deal (NULL = 100%, fully owned). */
  recognizedPercent: string | null
  /** weightedValue × recognizedPercent — the entity's OWN expected revenue. */
  recognizedWeightedValue: string
  /** "own" = this entity's funnel; "inbound" = share of a sibling's deal this
   *  entity handles as intercompany delivery partner. */
  source: "own" | "inbound"
  /** Origin entity name for inbound rows (null on own rows). */
  originEntityName: string | null
}

/** One row of the pipeline summary (per stage per funnel per currency). */
export type PipelineSummaryRow = {
  funnelId: string | null
  stageCode: string | null
  stageName: string | null
  stageKind: string | null
  sortOrder: number
  opportunityCount: number
  totalAmount: string
  weightedAmount: string
  currency: string | null
}

/**
 * Read-only weighted billing forecast for the active tenant.
 * Derived from `v_billing_forecast`; never an editable table.
 */
export async function getForecast(): Promise<ForecastRow[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FORECAST_VIEW)
  return runInTenant(ctx.tenantId, async (tx) => {
    // Record-level owner scoping (mirrors listOpportunities): a Rep sees only
    // funnels they own or manage; view-all / manage-all / superadmin see all.
    const visible = await visibleMemberIds(tx, ctx)
    const ownerFilter =
      visible === null || canManageAllRecords(ctx)
        ? undefined
        : visible.length === 0
          ? sql`false`
          : inArray(sql`owner_member_id`, visible)
    const result = await tx.execute(
      ownerFilter
        ? sql`select * from v_billing_forecast where ${ownerFilter} order by forecast_month nulls last`
        : sql`select * from v_billing_forecast order by forecast_month nulls last`
    )
    const rows = result as unknown as Record<string, unknown>[]
    const own: ForecastRow[] = rows.map((r) => ({
      opportunityId: String(r.opportunity_id),
      opportunityName: String(r.opportunity_name ?? ""),
      accountId: r.account_id == null ? null : String(r.account_id),
      ownerMemberId: r.owner_member_id == null ? null : String(r.owner_member_id),
      funnelId: r.funnel_id == null ? null : String(r.funnel_id),
      stageCode: r.stage_code == null ? null : String(r.stage_code),
      stageName: r.stage_name == null ? null : String(r.stage_name),
      probability: r.probability == null ? null : String(r.probability),
      currency: r.currency == null ? null : String(r.currency),
      expectedCloseDate:
        r.expected_close_date == null ? null : String(r.expected_close_date),
      forecastMonth: r.forecast_month == null ? null : String(r.forecast_month),
      opportunityValue: String(r.opportunity_value ?? "0"),
      weightedValue: String(r.weighted_value ?? "0"),
      recognizedPercent:
        r.recognized_percent == null ? null : String(r.recognized_percent),
      recognizedWeightedValue: String(
        r.recognized_weighted_value ?? r.weighted_value ?? "0"
      ),
      source: "own" as const,
      originEntityName: null,
    }))

    // INBOUND intercompany share: deals sibling entities assigned to this
    // entity for delivery. This entity's own party row carries its OWN share
    // (independent of any other party on the deal — see lib/interco-share.ts)
    // and belongs in its forecast, weighted by the origin's stage probability
    // (snapshotted on the mirror). Gated by the intercompany permission so
    // record-scoped reps don't see whole-entity numbers through the back door.
    if (!ctx.can(PERMISSIONS.INTERCOMPANY_VIEW)) return own

    const inboundRows = await tx
      .select({
        id: intercompanyDeals.id,
        name: intercompanyDeals.name,
        originEntityName: organization.name,
        currency: intercompanyDeals.currency,
        estimatedAmount: intercompanyDeals.estimatedAmount,
        quotedAmount: intercompanyDeals.quotedAmount,
        shareType: intercompanyDeals.shareType,
        shareValue: intercompanyDeals.shareValue,
        stageName: intercompanyDeals.stageName,
        stageProbability: intercompanyDeals.stageProbability,
        expectedCloseDate: intercompanyDeals.expectedCloseDate,
      })
      .from(intercompanyDeals)
      .leftJoin(organization, eq(intercompanyDeals.tenantId, organization.id))
      .where(
        and(
          eq(intercompanyDeals.partnerTenantId, ctx.tenantId),
          eq(intercompanyDeals.includeInForecast, true)
        )
      )
      .orderBy(desc(intercompanyDeals.updatedAt))

    const inbound: ForecastRow[] = inboundRows.flatMap((d) => {
      const basis = Number(d.quotedAmount ?? d.estimatedAmount ?? 0)
      const share = partyShare(
        { shareType: d.shareType, shareValue: Number(d.shareValue) },
        basis,
        basis
      )
      if (share <= 0) return []
      const probability = Number(d.stageProbability ?? 0)
      const weighted = (share * probability) / 100
      const month = d.expectedCloseDate
        ? `${d.expectedCloseDate.slice(0, 7)}-01`
        : null
      return [
        {
          opportunityId: d.id,
          opportunityName: d.name,
          accountId: null,
          ownerMemberId: null,
          funnelId: null,
          stageCode: null,
          stageName: d.stageName,
          probability: d.stageProbability,
          currency: d.currency,
          expectedCloseDate: d.expectedCloseDate,
          forecastMonth: month,
          opportunityValue: share.toFixed(2),
          weightedValue: weighted.toFixed(2),
          // The share IS this entity's recognized revenue on the deal.
          recognizedPercent: null,
          recognizedWeightedValue: weighted.toFixed(2),
          source: "inbound" as const,
          originEntityName: d.originEntityName,
        },
      ]
    })

    return [...own, ...inbound]
  })
}

/** Presentation config for the forecast page (no separate permission — the
 *  page is already gated by FORECAST_VIEW). */
export async function getForecastConfig(): Promise<{
  fiscalYearStartMonth: number
}> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FORECAST_VIEW)
  return runInTenant(ctx.tenantId, async (tx) => {
    const [s] = await tx
      .select({ month: tenantSettings.fiscalYearStartMonth })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return { fiscalYearStartMonth: s?.month ?? 1 }
  })
}

/**
 * Read-only pipeline summary (counts + amounts per stage) for the active tenant.
 * Derived from `v_pipeline_summary`.
 */
export async function getPipelineSummary(): Promise<PipelineSummaryRow[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FORECAST_VIEW)
  return runInTenant(ctx.tenantId, async (tx) => {
    // Record-level owner scoping (mirrors listOpportunities): a Rep sees only
    // funnels they own or manage; view-all / manage-all / superadmin see all.
    // The view carries owner_member_id at per-owner grain, so filter on it then
    // re-aggregate back to one row per (funnel, stage, currency).
    const visible = await visibleMemberIds(tx, ctx)
    const ownerFilter =
      visible === null || canManageAllRecords(ctx)
        ? undefined
        : visible.length === 0
          ? sql`false`
          : inArray(sql`owner_member_id`, visible)
    const result = await tx.execute(sql`
      select
        funnel_id,
        stage_code,
        stage_name,
        stage_kind,
        sort_order,
        sum(opportunity_count) as opportunity_count,
        sum(total_amount) as total_amount,
        sum(weighted_amount) as weighted_amount,
        currency
      from v_pipeline_summary
      ${ownerFilter ? sql`where ${ownerFilter}` : sql``}
      group by funnel_id, stage_code, stage_name, stage_kind, sort_order, currency
      order by sort_order asc
    `)
    const rows = result as unknown as Record<string, unknown>[]
    return rows.map((r) => ({
      funnelId: r.funnel_id == null ? null : String(r.funnel_id),
      stageCode: r.stage_code == null ? null : String(r.stage_code),
      stageName: r.stage_name == null ? null : String(r.stage_name),
      stageKind: r.stage_kind == null ? null : String(r.stage_kind),
      sortOrder: Number(r.sort_order ?? 0),
      opportunityCount: Number(r.opportunity_count ?? 0),
      totalAmount: String(r.total_amount ?? "0"),
      weightedAmount: String(r.weighted_amount ?? "0"),
      currency: r.currency == null ? null : String(r.currency),
    }))
  })
}
