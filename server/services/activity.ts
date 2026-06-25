import "server-only"
import type { Tx } from "@/db"
import { activities } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"

export type ActivityEntity =
  | "account"
  | "person"
  | "lead"
  | "opportunity"
  | "project"
export type ActivityKind =
  | "note"
  | "call"
  | "meeting"
  | "email"
  | "system"
  | "stage_change"
  | "file"

/**
 * Append an activity to an entity's timeline. Call inside an existing
 * tenant transaction (`tx`) so auto-events are atomic with the change that
 * triggered them.
 */
export async function logActivity(
  tx: Tx,
  ctx: ServerContext,
  input: {
    entityType: ActivityEntity
    entityId: string
    type: ActivityKind
    subject?: string | null
    body?: string | null
    outcome?: string | null
    nextStep?: string | null
    dueAt?: Date | null
    occurredAt?: Date
  }
): Promise<void> {
  await tx.insert(activities).values({
    tenantId: ctx.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    type: input.type,
    subject: input.subject ?? null,
    body: input.body ?? null,
    outcome: input.outcome ?? null,
    nextStep: input.nextStep ?? null,
    dueAt: input.dueAt ?? null,
    memberId: ctx.memberId,
    occurredAt: input.occurredAt ?? undefined,
  })
}
