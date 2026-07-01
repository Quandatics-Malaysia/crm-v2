"use server"

import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { contractYears, opportunities } from "@/db/schema"

export type ContractYearRow = typeof contractYears.$inferSelect

export type ContractYearInput = {
  year?: number | null
  title?: string | null
  amount?: string | null
  currency?: string | null
  status?: "planned" | "invoiced" | "cancelled"
  notes?: string | null
}

function clean(v?: string | null): string | null {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

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

export async function listContractYears(
  opportunityId: string
): Promise<ContractYearRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    await assertOppAccess(tx, ctx, opportunityId)
    return tx
      .select()
      .from(contractYears)
      .where(eq(contractYears.opportunityId, opportunityId))
      .orderBy(asc(contractYears.year), asc(contractYears.sortOrder))
  })
}

export async function createContractYear(
  opportunityId: string,
  input: ContractYearInput
): Promise<ActionResult<ContractYearRow>> {
  return runAction(async () => {
    if (!input.year) throw new Error("A year is required")
    const row = await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      await assertOppAccess(tx, ctx, opportunityId)
      const [oppCurrency] = await tx
        .select({ currency: opportunities.currency })
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1)
      const [created] = await tx
        .insert(contractYears)
        .values({
          tenantId: ctx.tenantId,
          opportunityId,
          year: input.year!,
          title: clean(input.title),
          amount: input.amount ? Number(input.amount).toFixed(2) : "0",
          currency:
            (clean(input.currency) ?? oppCurrency?.currency ?? "MYR")
              .toUpperCase()
              .slice(0, 3),
          status: input.status ?? "planned",
          notes: clean(input.notes),
          sortOrder: input.year!,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "contract_year.created",
        entityType: "opportunity",
        entityId: opportunityId,
        after: { id: created.id, year: created.year },
      })
      return created
    })
    revalidatePath(`/funnel/${opportunityId}`)
    return row
  })
}

export async function updateContractYear(
  id: string,
  input: ContractYearInput
): Promise<ActionResult<ContractYearRow>> {
  return runAction(async () => {
    const row = await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(contractYears)
        .where(eq(contractYears.id, id))
        .limit(1)
      if (!before) throw new Error("Contract year not found")
      await assertOppAccess(tx, ctx, before.opportunityId)
      const [updated] = await tx
        .update(contractYears)
        .set({
          year: input.year ?? before.year,
          title: input.title === undefined ? before.title : clean(input.title),
          amount:
            input.amount === undefined
              ? before.amount
              : Number(input.amount || 0).toFixed(2),
          currency: input.currency
            ? input.currency.toUpperCase().slice(0, 3)
            : before.currency,
          status: input.status ?? before.status,
          notes: input.notes === undefined ? before.notes : clean(input.notes),
          updatedAt: new Date(),
        })
        .where(eq(contractYears.id, id))
        .returning()
      await writeAudit(tx, ctx, {
        action: "contract_year.updated",
        entityType: "opportunity",
        entityId: before.opportunityId,
        after: { id, year: updated.year, status: updated.status },
      })
      return updated
    })
    revalidatePath(`/funnel/${row.opportunityId}`)
    return row
  })
}

export async function deleteContractYear(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(contractYears)
        .where(eq(contractYears.id, id))
        .limit(1)
      if (!before) throw new Error("Contract year not found")
      await assertOppAccess(tx, ctx, before.opportunityId)
      await tx.delete(contractYears).where(eq(contractYears.id, id))
      await writeAudit(tx, ctx, {
        action: "contract_year.deleted",
        entityType: "opportunity",
        entityId: before.opportunityId,
      })
      revalidatePath(`/funnel/${before.opportunityId}`)
    })
  })
}
