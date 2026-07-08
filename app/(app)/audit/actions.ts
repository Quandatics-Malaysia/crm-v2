"use server"

import { desc, eq } from "drizzle-orm"
import { withModule } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { auditLog, member, user } from "@/db/schema"

export type AuditRow = {
  id: string
  action: string
  entityType: string
  entityId: string
  actorName: string | null
  ip: string | null
  createdAt: string
}

/**
 * Tenant-scoped audit trail, newest first (limit 500). Resolves the acting
 * member back to a user name; deployment-level events surface as a null actor.
 */
export async function listAudit(): Promise<AuditRow[]> {
  return withModule("audit", PERMISSIONS.AUDIT_VIEW, async (tx) => {
    const rows = await tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        actorName: user.name,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(member, eq(auditLog.actorMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(500)

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }))
  })
}
