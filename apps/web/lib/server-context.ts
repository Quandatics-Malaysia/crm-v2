import "server-only"
import { headers } from "next/headers"
import { and, asc, eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, runInTenant } from "@/db"
import {
  user as userTable,
  member,
  membershipProfiles,
  memberRoles,
  roles,
  rolePermissions,
  permissions as permissionsTable,
  tenantSettings,
} from "@/db/schema"
import type { PermissionKey } from "@/lib/permissions"
import { isSubscriptionEntitlementActive, type SubscriptionStatus } from "@/lib/subscription-licensing"

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
  /** Membership lifecycle. A non-active member has zero effective permissions. */
  status: "active" | "invited" | "disabled"
  /** Tenant lifecycle — a suspended tenant is locked for everyone in it. */
  tenantSuspended: boolean
  /** The issued licence is not currently within its active validity window. */
  subscriptionInactive: boolean
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

  // Resolve the member row for the active tenant (or fall back to the user's
  // oldest membership — a STABLE key, so a multi-org user always lands in the
  // same tenant rather than an arbitrary `.limit(1)` pick).
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
        await db
          .select()
          .from(member)
          .where(eq(member.userId, sessionUser.id))
          .orderBy(asc(member.createdAt), asc(member.id))
          .limit(1)
      )[0]

  // is_superadmin lives on our user table extension.
  const [u] = await db
    .select({
      isSuperadmin: userTable.isSuperadmin,
      isVendorSupport: userTable.isVendorSupport,
    })
    .from(userTable)
    .where(eq(userTable.id, sessionUser.id))
    .limit(1)
  const isSuperadmin = u?.isSuperadmin ?? false

  // Support identities are operational principals, never tenant principals.
  // Even a stale legacy member row must not grant standing CRM access.
  if (u?.isVendorSupport) {
    return {
      userId: sessionUser.id,
      userName: sessionUser.name,
      userEmail: sessionUser.email,
      isSuperadmin: false,
      tenantId: "",
      memberId: null,
      tierLevel: 0,
      roleName: null,
      status: "disabled",
      tenantSuspended: false,
      subscriptionInactive: false,
      permissions: new Set(),
      can: () => false,
    }
  }

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
      status: "active",
      tenantSuspended: false,
      subscriptionInactive: false,
      permissions: new Set(),
      can: () => isSuperadmin,
    }
  }

  const tenantId = memberRow.organizationId

  // First resolve with no active org yet: persist the deterministic choice so
  // subsequent requests are stable. Best-effort — setting the session cookie is
  // only possible in a request that can write cookies (actions/route handlers),
  // so we swallow failures during pure Server Component renders.
  if (!activeOrgId) {
    try {
      await auth.api.setActiveOrganization({
        body: { organizationId: tenantId },
        headers: await headers(),
      })
    } catch {
      // ignore — the next mutation/navigation will persist it
    }
  }

  const resolved = await runInTenant(tenantId, async (tx) => {
    const [profile] = await tx
      .select()
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberRow.id))
      .limit(1)

    // Tenant lifecycle: `tenant_settings.status = 'suspended'` locks the
    // whole entity (previously a dead flag — it was never consulted).
    const [settings] = await tx
      .select({
        status: tenantSettings.status,
        subscriptionStatus: tenantSettings.subscriptionStatus,
        subscriptionStartsAt: tenantSettings.subscriptionStartsAt,
        subscriptionEndsAt: tenantSettings.subscriptionEndsAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, tenantId))
      .limit(1)
    const tenantSuspended = settings?.status === "suspended"
    const subscriptionInactive = !isSubscriptionEntitlementActive(new Date(), {
      status: (settings?.subscriptionStatus ?? "active") as SubscriptionStatus,
      startsAt: settings?.subscriptionStartsAt ?? null,
      endsAt: settings?.subscriptionEndsAt ?? null,
    })

    // A member can hold MANY roles; effective permissions = the UNION of every
    // assigned role's grants (member_roles). Fall back to the legacy single
    // membership_profiles.role_id if no member_roles rows exist yet.
    const roleRows = await tx
      .select({ id: memberRoles.roleId, name: roles.name })
      .from(memberRoles)
      .innerJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(eq(memberRoles.memberId, memberRow.id))
      .orderBy(asc(roles.name))
    let roleIds = roleRows.map((r) => r.id)
    let roleNames = roleRows.map((r) => r.name)
    if (roleIds.length === 0 && profile?.roleId) {
      const [r] = await tx
        .select({ name: roles.name })
        .from(roles)
        .where(eq(roles.id, profile.roleId))
        .limit(1)
      roleIds = [profile.roleId]
      roleNames = r?.name ? [r.name] : []
    }
    const roleName = roleNames.length ? roleNames.join(", ") : null

    const permKeys: string[] = []
    if (roleIds.length) {
      const rows = await tx
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(
          permissionsTable,
          eq(rolePermissions.permissionId, permissionsTable.id)
        )
        .where(inArray(rolePermissions.roleId, roleIds))
      for (const row of rows) permKeys.push(row.key)
    }

    return {
      tierLevel: profile?.tierLevel ?? 0,
      roleName,
      permKeys,
      status: (profile?.status ?? "active") as ServerContext["status"],
      tenantSuspended,
      subscriptionInactive,
    }
  })

  // A disabled (or not-yet-active/invited) member — or anyone in a suspended
  // tenant — keeps no effective permissions: every assertCan fails, locking
  // them out without a hard delete.
  const isActive =
    resolved.status === "active" &&
    !resolved.tenantSuspended &&
    (isSuperadmin || !resolved.subscriptionInactive)
  const perms = new Set(isActive ? resolved.permKeys : [])

  return {
    userId: sessionUser.id,
    userName: sessionUser.name,
    userEmail: sessionUser.email,
    isSuperadmin,
    tenantId,
    memberId: memberRow.id,
    tierLevel: resolved.tierLevel,
    roleName: resolved.roleName,
    status: resolved.status,
    tenantSuspended: resolved.tenantSuspended,
    subscriptionInactive: resolved.subscriptionInactive,
    permissions: perms,
    can: (key) => isSuperadmin || perms.has(key as string),
  }
}

/** Throws if unauthenticated, has no active tenant, the tenant is suspended,
 * or the membership is not active (e.g. disabled/invited). Use in server
 * actions. */
export async function requireContext(): Promise<ServerContext> {
  const ctx = await getServerContext()
  if (!ctx) throw new Error("UNAUTHENTICATED")
  if (!ctx.tenantId) throw new Error("NO_ACTIVE_TENANT")
  if (ctx.tenantSuspended) {
    throw new Error(
      "This organization is suspended. Contact your administrator."
    )
  }
  if (ctx.status !== "active") {
    throw new Error("Your membership in this organization is not active.")
  }
  if (ctx.subscriptionInactive && !ctx.isSuperadmin) {
    throw new Error("This organization's seat licence is not currently active.")
  }
  return ctx
}

export function assertCan(ctx: ServerContext, key: PermissionKey | string) {
  if (!ctx.can(key)) throw new Error(`FORBIDDEN: missing ${key}`)
}
