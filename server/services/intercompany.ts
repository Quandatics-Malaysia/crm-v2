import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  opportunities,
  accounts,
  funnelStages,
  intercompanyDeals,
} from "@/db/schema"

/**
 * Upsert (or remove) the read-only mirror row the handling partner entity
 * sees for an intercompany deal. Call after ANY mutation that changes what
 * the partner should see: create/update/soft-delete of the opportunity, a
 * stage move, or a quoted-amount sync. Idempotent — it re-reads the deal and
 * writes the full snapshot, so callers never pass field-level deltas.
 *
 * Runs inside the ORIGIN tenant's transaction; RLS write policies on
 * intercompany_deals only permit the origin side (see db/sql/rls.sql).
 */
export async function syncIntercompanyMirror(
  tx: Tx,
  opportunityId: string
): Promise<void> {
  const [row] = await tx
    .select({
      id: opportunities.id,
      tenantId: opportunities.tenantId,
      deletedAt: opportunities.deletedAt,
      isIntercompany: opportunities.isIntercompany,
      partnerTenantId: opportunities.handlingPartnerEntityId,
      name: opportunities.name,
      accountName: accounts.name,
      currency: opportunities.currency,
      estimatedAmount: opportunities.estimatedAmount,
      quotedAmount: opportunities.amount,
      recognizedPercent: opportunities.recognizedPercent,
      status: opportunities.status,
      stageName: funnelStages.name,
      stageProbability: funnelStages.probability,
      stageKind: funnelStages.kind,
      stageInForecast: funnelStages.includeInForecast,
      expectedCloseDate: opportunities.expectedCloseDate,
      projectYear: opportunities.projectYear,
    })
    .from(opportunities)
    .leftJoin(accounts, eq(opportunities.accountId, accounts.id))
    .leftJoin(funnelStages, eq(opportunities.currentStageId, funnelStages.id))
    .where(eq(opportunities.id, opportunityId))
    .limit(1)

  // Gone, soft-deleted, or no longer an interco deal with a partner set —
  // the partner must stop seeing it.
  if (!row || row.deletedAt || !row.isIntercompany || !row.partnerTenantId) {
    await tx
      .delete(intercompanyDeals)
      .where(eq(intercompanyDeals.opportunityId, opportunityId))
    return
  }

  const snapshot = {
    tenantId: row.tenantId,
    opportunityId: row.id,
    partnerTenantId: row.partnerTenantId,
    name: row.name,
    accountName: row.accountName ?? null,
    currency: row.currency,
    estimatedAmount: row.estimatedAmount,
    quotedAmount: row.quotedAmount,
    recognizedPercent: row.recognizedPercent,
    status: row.status,
    stageName: row.stageName ?? null,
    stageProbability: row.stageProbability ?? null,
    // Forecast eligibility mirrors v_billing_forecast: the stage must be
    // included AND live (OPEN/WON) — the partner's forecast applies the same
    // rule to its share without reading the origin's funnel_stages.
    includeInForecast:
      (row.stageInForecast ?? true) &&
      (row.stageKind === "OPEN" || row.stageKind === "WON"),
    expectedCloseDate: row.expectedCloseDate,
    projectYear: row.projectYear,
    updatedAt: new Date(),
  }
  await tx
    .insert(intercompanyDeals)
    .values(snapshot)
    .onConflictDoUpdate({
      target: intercompanyDeals.opportunityId,
      set: snapshot,
    })
}
