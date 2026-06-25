import "server-only"
import type { Tx } from "@/db"
import { auditLog } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"

export async function writeAudit(
  tx: Tx,
  ctx: ServerContext,
  entry: {
    action: string
    entityType: string
    entityId: string
    before?: unknown
    after?: unknown
  }
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorMemberId: ctx.memberId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: (entry.before as object | null) ?? null,
    after: (entry.after as object | null) ?? null,
  })
}
