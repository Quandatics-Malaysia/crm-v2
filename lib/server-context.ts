import "server-only"
import { headers } from "next/headers"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, runInTenant } from "@/db"
import {
  user as userTable,
  member,
  membershipProfiles,
  roles,
  rolePermissions,
  permissions as permissionsTable,
} from "@/db/schema"
import type { PermissionKey } from "@/lib/permissions"

export type ServerContext = {
  userId: string
  userName: string
  userEmail: string
  isSuperadmin: boolean
  /** Active tenant = active organization id. Empty string if the user has no membership yet. */
  tenantId: string
  memberId: string | null
  tierLevel: number
  roleName: string | null
  permissions: Set<string>
  can: (key: PermissionKey | string) => boolean
}

/**
 * Resolve the authenticated request context: user, active tenant, member,
 * effective permissions. Returns null when unauthenticated.
 */
export async function getServerContext(): Promise<ServerContext | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const sessionUser = session.user
  const activeOrgId = session.session.activeOrganizationId ?? null

  // Resolve the member row for the active tenant (or fall back to any membership).
  const memberRow = activeOrgId
    ? (
        await db
          .select()
          .from(member)
          .where(
            and(eq(member.userId, sessionUser.id), eq(member.organizationId, activeOrgId))
          )
          .limit(1)
      )[0]
    : (
        await db.select().from(member).where(eq(member.userId, sessionUser.id)).limit(1)
      )[0]

  // is_superadmin lives on our user table extension.
  const [u] = await db
    .select({ isSuperadmin: userTable.isSuperadmin })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)
  const isSuperadmin = u?.isSuperadmin ?? false

  if (!memberRow) {
    return {
      userId: sessionUser.id,
      userName: sessionUser.name,
      userEmail: sessionUser.email,
      isSuperadmin,
      tenantId: "",
      memberId: null,
      tierLevel: 0,
      roleName: null,
      permissions: new Set(),
      can: (key) => isSuperadmin,
    }
  }

  const tenantId = memberRow.organizationId

  const resolved = await runInTenant(tenantId, async (tx) => {
    const [profile] = await tx
      .select()
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberRow.id))
      .limit(1)

    let roleName: string | null = null
    const permKeys: string[] = []

    if (profile?.roleId) {
      const [r] = await tx
        .select({ name: roles.name })
        .from(roles)
        .where(eq(roles.id, profile.roleId))
        .limit(1)
      roleName = r?.name ?? null

      const rows = await tx
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(
          permissionsTable,
          eq(rolePermissions.permissionId, permissionsTable.id)
        )
        .where(eq(rolePermissions.roleId, profile.roleId))
      for (const row of rows) permKeys.push(row.key)
    }

    return { tierLevel: profile?.tierLevel ?? 0, roleName, permKeys }
  })

  const perms = new Set(resolved.permKeys)

  return {
    userId: sessionUser.id,
    userName: sessionUser.name,
    userEmail: sessionUser.email,
    isSuperadmin,
    tenantId,
    memberId: memberRow.id,
    tierLevel: resolved.tierLevel,
    roleName: resolved.roleName,
    permissions: perms,
    can: (key) => isSuperadmin || perms.has(key as string),
  }
}

/** Throws if unauthenticated or has no active tenant. Use in server actions. */
export async function requireContext(): Promise<ServerContext> {
  const ctx = await getServerContext()
  if (!ctx) throw new Error("UNAUTHENTICATED")
  if (!ctx.tenantId) throw new Error("NO_ACTIVE_TENANT")
  return ctx
}

export function assertCan(ctx: ServerContext, key: PermissionKey | string) {
  if (!ctx.can(key)) throw new Error(`FORBIDDEN: missing ${key}`)
}
