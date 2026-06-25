"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireContext } from "@/lib/server-context"
import { runInTenant } from "@/db"
import { activities, member, user } from "@/db/schema"
import { logActivity, type ActivityEntity, type ActivityKind } from "@/server/services/activity"

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
}

/** Timeline for one entity, newest first. Any tenant member may read it. */
export async function listActivities(
  entityType: ActivityEntity,
  entityId: string
): Promise<ActivityRow[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
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
}): Promise<void> {
  const ctx = await requireContext()
  await runInTenant(ctx.tenantId, (tx) =>
    logActivity(tx, ctx, {
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
  )
  if (input.revalidate) revalidatePath(input.revalidate)
}
