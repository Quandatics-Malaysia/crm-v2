"use server"

import { and, desc, eq, inArray, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireContext, assertCan } from "@/lib/server-context"
import { canAccessAttachable } from "@/lib/access-scope"
import { attachViewPerm, attachWritePerm } from "./attachment-perms"
import { runAction, type ActionResult } from "@/lib/action-result"
import { runInTenant, type Tx } from "@/db"
import {
  activities,
  member,
  user,
  persons,
  funnels,
  projects,
} from "@/db/schema"
import { logActivity, type ActivityEntity, type ActivityKind } from "@/server/services/activity"
import type { ChangeEntry } from "@/server/services/changes/types"

export type ActivityRow = {
  id: string
  type: ActivityKind
  subject: string | null
  body: string | null
  outcome: string | null
  nextStep: string | null
  dueAt: string | null
  memberName: string | null
  occurredAt: string
  changes: ChangeEntry[] | null
}

/** Timeline for one entity, newest first. Gated by the per-type view
 *  permission and record-scope access (mirrors the attachment actions). */
export async function listActivities(
  entityType: ActivityEntity,
  entityId: string
): Promise<ActivityRow[]> {
  const ctx = await requireContext()
  assertCan(ctx, attachViewPerm(entityType))
  return runInTenant(ctx.tenantId, async (tx) => {
    if (!(await canAccessAttachable(tx, ctx, entityType, entityId, "view")))
      return []
    const rows = await tx
      .select({
        id: activities.id,
        type: activities.type,
        subject: activities.subject,
        body: activities.body,
        outcome: activities.outcome,
        nextStep: activities.nextStep,
        dueAt: activities.dueAt,
        occurredAt: activities.occurredAt,
        memberName: user.name,
        changes: activities.changes,
      })
      .from(activities)
      .leftJoin(member, eq(activities.memberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(activities.entityType, entityType),
          eq(activities.entityId, entityId)
        )
      )
      .orderBy(desc(activities.occurredAt))
      .limit(200)
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      subject: r.subject,
      body: r.body,
      outcome: r.outcome,
      nextStep: r.nextStep,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      memberName: r.memberName,
      occurredAt: r.occurredAt.toISOString(),
      changes: r.changes as ChangeEntry[] | null,
    }))
  })
}

export type TimelineRow = ActivityRow & { sourceType: ActivityEntity }

/** Collect (entityType, ids) the rollup should include for a root entity. */
async function rollupPairs(
  tx: Tx,
  rootType: ActivityEntity,
  rootId: string
): Promise<{ type: ActivityEntity; ids: string[] }[]> {
  if (rootType === "account") {
    const personIds = (
      await tx.select({ id: persons.id }).from(persons).where(eq(persons.accountId, rootId))
    ).map((r) => r.id)
    const oppIds = (
      await tx
        .select({ id: funnels.id })
        .from(funnels)
        .where(eq(funnels.accountId, rootId))
    ).map((r) => r.id)
    const projIds = (
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.accountId, rootId))
    ).map((r) => r.id)
    return [
      { type: "account", ids: [rootId] },
      { type: "person", ids: personIds },
      { type: "opportunity", ids: oppIds },
      { type: "project", ids: projIds },
    ]
  }
  if (rootType === "person") {
    const oppIds = (
      await tx
        .select({ id: funnels.id })
        .from(funnels)
        .where(eq(funnels.primaryPersonId, rootId))
    ).map((r) => r.id)
    return [
      { type: "person", ids: [rootId] },
      { type: "opportunity", ids: oppIds },
    ]
  }
  if (rootType === "project") {
    const [p] = await tx
      .select({ oppId: projects.funnelId })
      .from(projects)
      .where(eq(projects.id, rootId))
      .limit(1)
    const pairs: { type: ActivityEntity; ids: string[] }[] = [
      { type: "project", ids: [rootId] },
    ]
    if (p?.oppId) pairs.push({ type: "opportunity", ids: [p.oppId] })
    return pairs
  }
  return [{ type: rootType, ids: [rootId] }]
}

/** Rolled-up timeline: the entity's own activity plus its children's. */
export async function listEntityTimeline(
  rootType: ActivityEntity,
  rootId: string
): Promise<TimelineRow[]> {
  const ctx = await requireContext()
  assertCan(ctx, attachViewPerm(rootType))
  return runInTenant(ctx.tenantId, async (tx) => {
    if (!(await canAccessAttachable(tx, ctx, rootType, rootId, "view")))
      return []
    const pairs = (await rollupPairs(tx, rootType, rootId)).filter(
      (p) => p.ids.length > 0
    )
    const conds = pairs.map((p) =>
      and(eq(activities.entityType, p.type), inArray(activities.entityId, p.ids))
    )
    if (!conds.length) return []
    const rows = await tx
      .select({
        id: activities.id,
        type: activities.type,
        subject: activities.subject,
        body: activities.body,
        outcome: activities.outcome,
        nextStep: activities.nextStep,
        dueAt: activities.dueAt,
        occurredAt: activities.occurredAt,
        memberName: user.name,
        sourceType: activities.entityType,
        changes: activities.changes,
      })
      .from(activities)
      .leftJoin(member, eq(activities.memberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(or(...conds))
      .orderBy(desc(activities.occurredAt))
      .limit(200)
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      subject: r.subject,
      body: r.body,
      outcome: r.outcome,
      nextStep: r.nextStep,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      memberName: r.memberName,
      occurredAt: r.occurredAt.toISOString(),
      sourceType: r.sourceType,
      changes: r.changes as ChangeEntry[] | null,
    }))
  })
}

/** Add a standardized manual activity (note/call/meeting/email). */
export async function addActivity(input: {
  entityType: ActivityEntity
  entityId: string
  type: ActivityKind
  subject?: string
  body?: string
  outcome?: string
  nextStep?: string
  occurredAt?: string
  dueAt?: string
  revalidate?: string
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, attachWritePerm(input.entityType))
    await runInTenant(ctx.tenantId, async (tx) => {
      if (
        !(await canAccessAttachable(
          tx,
          ctx,
          input.entityType,
          input.entityId,
          "manage"
        ))
      ) {
        throw new Error("FORBIDDEN: not permitted on this record")
      }
      await logActivity(tx, ctx, {
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        subject: input.subject || null,
        body: input.body || null,
        outcome: input.outcome || null,
        nextStep: input.nextStep || null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      })
    })
    if (input.revalidate) revalidatePath(input.revalidate)
  })
}
