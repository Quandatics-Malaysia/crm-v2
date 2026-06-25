"use server"

import { sql } from "drizzle-orm"
import { runInTenant } from "@/db"
import { requireContext, assertCan } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"

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
}

/** One row of the pipeline summary (per stage per funnel). */
export type PipelineSummaryRow = {
  funnelId: string | null
  stageCode: string | null
  stageName: string | null
  stageKind: string | null
  sortOrder: number
  opportunityCount: number
  totalAmount: string
  weightedAmount: string
}

/**
 * Read-only weighted billing forecast for the active tenant.
 * Derived from `v_billing_forecast`; never an editable table.
 */
export async function getForecast(): Promise<ForecastRow[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FORECAST_VIEW)
  return runInTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute(
      sql`select * from v_billing_forecast order by forecast_month nulls last`
    )
    const rows = result as unknown as Record<string, unknown>[]
    return rows.map((r) => ({
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
    }))
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
    const result = await tx.execute(
      sql`select * from v_pipeline_summary order by sort_order asc`
    )
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
    }))
  })
}
