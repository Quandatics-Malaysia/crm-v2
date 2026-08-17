import "server-only"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Tx } from "@/db"
import { funnels, opportunities } from "@/db/schema"
import {
  normalizePpvvcValues,
  type PpvvcPatch,
  type PpvvcValues,
} from "@/lib/ppvvc"

type PpvvcSourceRow = {
  id: string
  tenantId: string
  deletedAt: Date | null
} & PpvvcValues

export type PpvvcSyncResult = {
  opportunityId: string
  actorId: string
  before: PpvvcValues
  after: PpvvcValues
  updatedChildIds: string[]
}

function valuesFromRow(row: PpvvcSourceRow): PpvvcValues {
  return normalizePpvvcValues(row)
}

/**
 * Update the authoritative Opportunity PPVVC row and all live child Funnels.
 * The caller supplies a tenant-scoped transaction; both writes deliberately
 * stay inside it so a child snapshot can never commit without its source.
 */
export async function updateOpportunityPpvvc(
  tx: Tx,
  input: {
    opportunityId: string
    values: PpvvcPatch
    actorId: string
  }
): Promise<PpvvcSyncResult> {
  const actorId = input.actorId.trim()
  if (!actorId) throw new Error("PPVVC updates require an authenticated actor")

  const [source] = await tx
    .select({
      id: opportunities.id,
      tenantId: opportunities.tenantId,
      deletedAt: opportunities.deletedAt,
      pain: opportunities.pain,
      power: opportunities.power,
      vision: opportunities.vision,
      value: opportunities.value,
      control: opportunities.control,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, input.opportunityId),
        isNull(opportunities.deletedAt)
      )
    )
    .limit(1)
    .for("update")

  if (!source) throw new Error("Opportunity not found")

  const before = valuesFromRow(source)
  const after = normalizePpvvcValues({ ...before, ...input.values })
  const changedAt = new Date()

  await tx
    .update(opportunities)
    .set({ ...after, updatedAt: changedAt })
    .where(
      and(
        eq(opportunities.id, source.id),
        eq(opportunities.tenantId, source.tenantId),
        isNull(opportunities.deletedAt)
      )
    )

  const children = await tx
    .select({ id: funnels.id, deletedAt: funnels.deletedAt })
    .from(funnels)
    .where(
      and(
        eq(funnels.opportunityId, source.id),
        eq(funnels.tenantId, source.tenantId),
        isNull(funnels.deletedAt)
      )
    )

  const updatedChildIds = children
    .filter((child) => child.deletedAt == null)
    .map((child) => child.id)

  if (updatedChildIds.length > 0) {
    await tx
      .update(funnels)
      .set({ ...after, updatedAt: changedAt })
      .where(
        and(
          eq(funnels.opportunityId, source.id),
          eq(funnels.tenantId, source.tenantId),
          inArray(funnels.id, updatedChildIds),
          isNull(funnels.deletedAt)
        )
      )
  }

  return {
    opportunityId: source.id,
    actorId,
    before,
    after,
    updatedChildIds,
  }
}

/** Resolve a live Funnel to its parent before invoking the authoritative sync. */
export async function updateFunnelPpvvc(
  tx: Tx,
  input: {
    funnelId: string
    values: PpvvcPatch
    actorId: string
  }
): Promise<PpvvcSyncResult> {
  const [funnel] = await tx
    .select({
      id: funnels.id,
      opportunityId: funnels.opportunityId,
      tenantId: funnels.tenantId,
      deletedAt: funnels.deletedAt,
    })
    .from(funnels)
    .where(and(eq(funnels.id, input.funnelId), isNull(funnels.deletedAt)))
    .limit(1)

  if (!funnel) throw new Error("Funnel not found")

  return updateOpportunityPpvvc(tx, {
    opportunityId: funnel.opportunityId,
    values: input.values,
    actorId: input.actorId,
  })
}
