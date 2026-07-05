"use server"

import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { tenantDefaultCurrency } from "@/server/services/tenant-currency"
import { writeAudit } from "@/server/audit"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { dealCosts, opportunities } from "@/db/schema"

export type DealCostRow = typeof dealCosts.$inferSelect

export type DealCostInput = {
  category?: string | null
  contractYear?: number | null
  partyKind?: "supplier" | "partner" | "partner_supplier"
  supplierName?: string | null
  poNumber?: string | null
  currency?: string | null
  amount?: string | null
  exchangeRate?: string | null
  notes?: string | null
}

function clean(v?: string | null): string | null {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

/** amountBase = amount × exchangeRate, rounded to 2dp. */
function baseAmount(amount?: string | null, rate?: string | null): string {
  const a = Number(amount ?? 0)
  const r = Number(rate ?? 1)
  const base = (Number.isFinite(a) ? a : 0) * (Number.isFinite(r) && r > 0 ? r : 1)
  return base.toFixed(2)
}

/** Record-level gate: the caller must own/manage the parent opportunity. */
async function assertOppAccess(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: Parameters<Parameters<typeof withTenant>[1]>[1],
  opportunityId: string
): Promise<void> {
  const [opp] = await tx
    .select({ ownerMemberId: opportunities.ownerMemberId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1)
  if (!opp) throw new Error("Funnel not found")
  const visible = await visibleMemberIds(tx, ctx)
  if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
    throw new Error("FORBIDDEN: not permitted on this funnel")
}

export async function listDealCosts(
  opportunityId: string
): Promise<DealCostRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    await assertOppAccess(tx, ctx, opportunityId)
    return tx
      .select()
      .from(dealCosts)
      .where(eq(dealCosts.opportunityId, opportunityId))
      .orderBy(asc(dealCosts.createdAt))
  })
}

export async function createDealCost(
  opportunityId: string,
  input: DealCostInput
): Promise<ActionResult<DealCostRow>> {
  return runAction(async () => {
    const row = await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      await assertOppAccess(tx, ctx, opportunityId)
      const amountBase = baseAmount(input.amount, input.exchangeRate)
      const [created] = await tx
        .insert(dealCosts)
        .values({
          tenantId: ctx.tenantId,
          opportunityId,
          category: clean(input.category),
          contractYear: input.contractYear ?? null,
          partyKind: input.partyKind ?? "supplier",
          supplierName: clean(input.supplierName),
          poNumber: clean(input.poNumber),
          currency: (
            clean(input.currency) ?? (await tenantDefaultCurrency(tx, ctx.tenantId))
          )
            .toUpperCase()
            .slice(0, 3),
          amount: input.amount ? Number(input.amount).toFixed(2) : "0",
          exchangeRate: input.exchangeRate
            ? Number(input.exchangeRate).toString()
            : "1",
          amountBase,
          notes: clean(input.notes),
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "deal_cost.created",
        entityType: "opportunity",
        entityId: opportunityId,
        after: { id: created.id, amountBase },
      })
      return created
    })
    revalidatePath(`/funnel/${opportunityId}`)
    return row
  })
}

export async function deleteDealCost(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(dealCosts)
        .where(eq(dealCosts.id, id))
        .limit(1)
      if (!before) throw new Error("Cost line not found")
      await assertOppAccess(tx, ctx, before.opportunityId)
      await tx.delete(dealCosts).where(eq(dealCosts.id, id))
      await writeAudit(tx, ctx, {
        action: "deal_cost.deleted",
        entityType: "opportunity",
        entityId: before.opportunityId,
      })
      revalidatePath(`/funnel/${before.opportunityId}`)
    })
  })
}
