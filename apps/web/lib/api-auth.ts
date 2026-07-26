import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db, runInTenant, type Tx } from "@/db"
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
import { assertCan, type ServerContext } from "@/lib/server-context"
import type { PermissionKey } from "@/lib/permissions"

/** sha256 hex of a raw API key. The DB only ever stores this digest. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

/**
 * Mint a fresh API key. The raw `key` is shown to the caller exactly once; only
 * `hash` is persisted (via the Task-1 provisioning path). `prefix` is a
 * non-secret display handle (`qdk_` + 8 chars).
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = "qdk_" + randomBytes(24).toString("base64url")
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

/**
 * Resolve a bearer API key to the SAME `ServerContext` the UI builds in
 * `getServerContext`. The key is verified only through the hardened
 * `verify_api_key` SECURITY DEFINER function (never a direct `api_keys` select),
 * which returns `(organization_id, member_id)` for a live key or zero rows.
 *
 * Effective permissions are loaded with the exact same query
 * `getServerContext` runs for its member, so a key can never grant more than
 * its member's role(s) — and a disabled member or suspended tenant yields an
 * empty permission set, just like the UI.
 */
export async function getApiContext(req: Request): Promise<ServerContext | null> {
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(qdk_[A-Za-z0-9_-]+)$/)
  if (!m) return null

  const hash = hashApiKey(m[1])
  // verify_api_key(p_hash text) RETURNS TABLE(organization_id text, member_id text)
  const rows = (await db.execute(
    sql`select * from verify_api_key(${hash})`
  )) as unknown as Array<{ organization_id: string; member_id: string }>
  const row = rows[0]
  if (!row) return null

  const organizationId = row.organization_id
  const memberId = row.member_id

  // Resolve the member (for its user) — the `member` table is a Better Auth
  // table, queried outside the tenant transaction exactly as getServerContext
  // does. Constrain by organization too as a defensive cross-check.
  const [memberRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)
  if (!memberRow) return null

  const [u] = await db
    .select({
      name: userTable.name,
      email: userTable.email,
      isSuperadmin: userTable.isSuperadmin,
    })
    .from(userTable)
    .where(eq(userTable.id, memberRow.userId))
    .limit(1)
  if (!u) return null
  const isSuperadmin = u.isSuperadmin ?? false

  // Effective permissions — a byte-for-byte mirror of the getServerContext
  // permission-loading block, scoped to this member inside the tenant GUC.
  const resolved = await runInTenant(organizationId, async (tx) => {
    const [profile] = await tx
      .select()
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))
      .limit(1)

    const [settings] = await tx
      .select({ status: tenantSettings.status })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1)
    const tenantSuspended = settings?.status === "suspended"

    // A member can hold MANY roles; effective permissions = the UNION of every
    // assigned role's grants. Fall back to the legacy single
    // membership_profiles.role_id if no member_roles rows exist yet.
    const roleRows = await tx
      .select({ id: memberRoles.roleId, name: roles.name })
      .from(memberRoles)
      .innerJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(eq(memberRoles.memberId, memberId))
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
      const rows2 = await tx
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(
          permissionsTable,
          eq(rolePermissions.permissionId, permissionsTable.id)
        )
        .where(inArray(rolePermissions.roleId, roleIds))
      for (const r of rows2) permKeys.push(r.key)
    }

    return {
      tierLevel: profile?.tierLevel ?? 0,
      roleName,
      permKeys,
      status: (profile?.status ?? "active") as ServerContext["status"],
      tenantSuspended,
    }
  })

  // A disabled/invited member — or anyone in a suspended tenant — keeps no
  // effective permissions: every assertCan fails, locking the key out without
  // a hard delete. Identical to getServerContext.
  const isActive = resolved.status === "active" && !resolved.tenantSuspended
  const perms = new Set(isActive ? resolved.permKeys : [])

  return {
    userId: memberRow.userId,
    userName: u.name,
    userEmail: u.email,
    isSuperadmin,
    tenantId: organizationId,
    memberId,
    tierLevel: resolved.tierLevel,
    roleName: resolved.roleName,
    status: resolved.status,
    tenantSuspended: resolved.tenantSuspended,
    permissions: perms,
    can: (key) => isSuperadmin || perms.has(key as string),
  }
}

/**
 * API sibling of `withTenant`: authorize the resolved key context against
 * `permission`, then run `fn` inside a tenant-scoped transaction (RLS GUC set).
 * Mirrors `lib/actions.ts` exactly — `assertCan` (403 path) then `runInTenant`.
 */
export async function withApiTenant<T>(
  ctx: ServerContext,
  permission: PermissionKey,
  fn: (tx: Tx, ctx: ServerContext) => Promise<T>
): Promise<T> {
  assertCan(ctx, permission)
  return runInTenant(ctx.tenantId, (tx) => fn(tx, ctx))
}
