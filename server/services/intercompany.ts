import "server-only"
import { and, eq, notInArray } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  funnels,
  accounts,
  pipelineStages,
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
  funnelId: string
): Promise<void> {
  const [row] = await tx
    .select({
      id: funnels.id,
      tenantId: funnels.tenantId,
      deletedAt: funnels.deletedAt,
      isIntercompany: funnels.isIntercompany,
      name: funnels.name,
      accountName: accounts.name,
      currency: funnels.currency,
      estimatedAmount: funnels.estimatedAmount,
      quotedAmount: funnels.amount,
      status: funnels.status,
      stageName: pipelineStages.name,
      stageProbability: pipelineStages.probability,
      stageKind: pipelineStages.kind,
      stageInForecast: pipelineStages.includeInForecast,
      expectedCloseDate: funnels.expectedCloseDate,
      projectYear: funnels.projectYear,
    })
    .from(funnels)
    .leftJoin(accounts, eq(funnels.accountId, accounts.id))
    .leftJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
    .where(eq(funnels.id, funnelId))
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
        .where(eq(intercompanyDealParties.funnelId, funnelId))
    : []

  // Gone, soft-deleted, no longer an interco deal, or no parties — nobody
  // should see it anymore.
  if (!row || row.deletedAt || !row.isIntercompany || parties.length === 0) {
    await tx
      .delete(intercompanyDeals)
      .where(eq(intercompanyDeals.funnelId, funnelId))
    return
  }

  const includeInForecast =
    (row.stageInForecast ?? true) &&
    (row.stageKind === "OPEN" || row.stageKind === "WON")

  for (const party of parties) {
    const snapshot = {
      tenantId: row.tenantId,
      funnelId: row.id,
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
        target: [intercompanyDeals.funnelId, intercompanyDeals.partnerTenantId],
        set: snapshot,
      })
  }

  // Drop mirror rows for parties no longer on the deal (e.g. a partner was
  // removed from a shrinking split).
  await tx
    .delete(intercompanyDeals)
    .where(
      and(
        eq(intercompanyDeals.funnelId, funnelId),
        notInArray(
          intercompanyDeals.partnerTenantId,
          parties.map((p) => p.partnerEntityId)
        )
      )
    )
}
