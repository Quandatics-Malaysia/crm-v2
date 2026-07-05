import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import { runInTenant } from "@/db"
import { member, membershipProfiles, roles, user } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"

export type DenialContact = { name: string; role: string }

/**
 * Who to point a permission-denied user at: their direct manager first (the
 * same reports-to relationship stage-approval routing uses, see
 * lib/access-scope.ts), falling back to any active Owner/Admin in the tenant.
 * `null` when neither resolves (e.g. a solo tenant with no roles assigned).
 */
export async function resolveDenialContact(
  ctx: ServerContext
): Promise<DenialContact | null> {
  if (!ctx.memberId) return null
  return runInTenant(ctx.tenantId, async (tx) => {
    const [self] = await tx
      .select({ managerMemberId: membershipProfiles.managerMemberId })
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, ctx.memberId!))
      .limit(1)

    if (self?.managerMemberId) {
      const [mgr] = await tx
        .select({ name: user.name, roleName: roles.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(
          membershipProfiles,
          eq(membershipProfiles.memberId, member.id)
        )
        .leftJoin(roles, eq(membershipProfiles.roleId, roles.id))
        .where(eq(member.id, self.managerMemberId))
        .limit(1)
      if (mgr) return { name: mgr.name, role: mgr.roleName ?? "Manager" }
    }

    const [admin] = await tx
      .select({ name: user.name, roleName: roles.name })
      .from(membershipProfiles)
      .innerJoin(roles, eq(membershipProfiles.roleId, roles.id))
      .innerJoin(member, eq(membershipProfiles.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(membershipProfiles.status, "active"),
          eq(roles.isSystem, true),
          inArray(roles.name, ["Owner", "Admin"])
        )
      )
      .orderBy(sql`case when ${roles.name} = 'Owner' then 0 else 1 end`)
      .limit(1)
    return admin ? { name: admin.name, role: admin.roleName } : null
  })
}
