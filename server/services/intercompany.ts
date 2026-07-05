import "server-only"
import { and, eq, notInArray } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  opportunities,
  accounts,
  funnelStages,
  intercompanyDeals,
  intercompanyDealParties,
} from "@/db/schema"

/**
 * Upsert (or remove) the read-only mirror rows the handling partner entities
 * see for an intercompany deal — one row per party in intercompany_deal_parties.
 * Call after ANY mutation that changes what a partner should see: create/update
 * of the opportunity or its party list, a stage move, or a quoted-amount sync.
 * Idempotent — it re-reads the deal + parties and writes the full snapshot, so
 * callers never pass field-level deltas.
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
      name: opportunities.name,
      accountName: accounts.name,
      currency: opportunities.currency,
      estimatedAmount: opportunities.estimatedAmount,
      quotedAmount: opportunities.amount,
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

  const parties = row
    ? await tx
        .select({
          partnerEntityId: intercompanyDealParties.partnerEntityId,
          shareType: intercompanyDealParties.shareType,
          shareValue: intercompanyDealParties.shareValue,
          currency: intercompanyDealParties.currency,
          manualFxRate: intercompanyDealParties.manualFxRate,
        })
        .from(intercompanyDealParties)
        .where(eq(intercompanyDealParties.opportunityId, opportunityId))
    : []

  // Gone, soft-deleted, no longer an interco deal, or no parties — nobody
  // should see it anymore.
  if (!row || row.deletedAt || !row.isIntercompany || parties.length === 0) {
    await tx
      .delete(intercompanyDeals)
      .where(eq(intercompanyDeals.opportunityId, opportunityId))
    return
  }

  const includeInForecast =
    (row.stageInForecast ?? true) &&
    (row.stageKind === "OPEN" || row.stageKind === "WON")

  for (const party of parties) {
    const snapshot = {
      tenantId: row.tenantId,
      opportunityId: row.id,
      partnerTenantId: party.partnerEntityId,
      name: row.name,
      accountName: row.accountName ?? null,
      currency: row.currency,
      estimatedAmount: row.estimatedAmount,
      quotedAmount: row.quotedAmount,
      shareType: party.shareType,
      shareValue: party.shareValue,
      partnerCurrency: party.currency,
      manualFxRate: party.manualFxRate,
      status: row.status,
      stageName: row.stageName ?? null,
      stageProbability: row.stageProbability ?? null,
      includeInForecast,
      expectedCloseDate: row.expectedCloseDate,
      projectYear: row.projectYear,
      updatedAt: new Date(),
    }
    await tx
      .insert(intercompanyDeals)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [intercompanyDeals.opportunityId, intercompanyDeals.partnerTenantId],
        set: snapshot,
      })
  }

  // Drop mirror rows for parties no longer on the deal (e.g. a partner was
  // removed from a shrinking split).
  await tx
    .delete(intercompanyDeals)
    .where(
      and(
        eq(intercompanyDeals.opportunityId, opportunityId),
        notInArray(
          intercompanyDeals.partnerTenantId,
          parties.map((p) => p.partnerEntityId)
        )
      )
    )
}
