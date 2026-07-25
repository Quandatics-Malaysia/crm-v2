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

/**
 * Audit an authentication / entity-lifecycle event (sign-in, entity creation)
 * that happens outside a normal ServerContext. audit_log is FORCE-RLS, so the
 * row MUST be tenant-scoped: call inside runInTenant(tenantId, …) so
 * app.current_tenant matches the tenantId written here. IP/user-agent (when
 * known) ride in the `after` payload since audit_log has no user_agent column.
 */
export async function writeAuthAudit(
  tx: Tx,
  entry: {
    tenantId: string
    action: string
    actorUserId: string | null
    actorMemberId?: string | null
    ip?: string | null
    userAgent?: string | null
    entityType?: string
    entityId?: string
    after?: unknown
  }
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId,
    actorMemberId: entry.actorMemberId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? "auth",
    entityId: entry.entityId ?? entry.actorUserId ?? "unknown",
    ip: entry.ip ?? null,
    after:
      entry.after != null
        ? (entry.after as object)
        : entry.userAgent
          ? { userAgent: entry.userAgent }
          : null,
  })
}
