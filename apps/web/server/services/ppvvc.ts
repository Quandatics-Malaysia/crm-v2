import "server-only"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { Tx } from "@/db"
import { funnels, opportunities } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"
import { recordChanges } from "@/server/services/changes/record"
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
  updatedChildren: {
    id: string
    before: PpvvcValues
    after: PpvvcValues
  }[]
}

/** Persist one meaningful audit/activity pair for the source and every live child. */
export async function recordPpvvcSyncChanges(
  tx: Tx,
  ctx: ServerContext,
  sync: PpvvcSyncResult
): Promise<void> {
  await recordChanges(tx, ctx, {
    entityType: "opportunity",
    registryKey: "opportunity",
    entityId: sync.opportunityId,
    before: sync.before as unknown as Record<string, unknown>,
    after: sync.after as unknown as Record<string, unknown>,
    subject: "Opportunity PPVVC updated",
  })
  for (const child of sync.updatedChildren) {
    await recordChanges(tx, ctx, {
      entityType: "opportunity",
      registryKey: "funnel",
      entityId: child.id,
      before: child.before as unknown as Record<string, unknown>,
      after: child.after as unknown as Record<string, unknown>,
      subject: "Funnel PPVVC updated",
    })
  }
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
    tenantId: string
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
        eq(opportunities.tenantId, input.tenantId),
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
    .select({
      id: funnels.id,
      tenantId: funnels.tenantId,
      deletedAt: funnels.deletedAt,
      pain: funnels.pain,
      power: funnels.power,
      vision: funnels.vision,
      value: funnels.value,
      control: funnels.control,
    })
    .from(funnels)
    .where(
      and(
        eq(funnels.opportunityId, source.id),
        eq(funnels.tenantId, source.tenantId),
        isNull(funnels.deletedAt)
      )
    )
    .for("update")

  const updatedChildIds = children
    .filter((child) => child.deletedAt == null)
    .map((child) => child.id)
  const updatedChildren = children
    .filter((child) => child.deletedAt == null)
    .map((child) => ({
      id: child.id,
      before: valuesFromRow(child),
      after,
    }))

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
    updatedChildren,
  }
}

/** Resolve a live Funnel to its parent before invoking the authoritative sync. */
export async function updateFunnelPpvvc(
  tx: Tx,
  input: {
    funnelId: string
    tenantId: string
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
    .where(
      and(
        eq(funnels.id, input.funnelId),
        eq(funnels.tenantId, input.tenantId),
        isNull(funnels.deletedAt)
      )
    )
    .limit(1)
    .for("update")

  if (!funnel) throw new Error("Funnel not found")

  return updateOpportunityPpvvc(tx, {
    opportunityId: funnel.opportunityId,
    tenantId: funnel.tenantId,
    values: input.values,
    actorId: input.actorId,
  })
}
