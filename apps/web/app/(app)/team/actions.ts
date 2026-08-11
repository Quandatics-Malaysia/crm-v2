"use server"

import { and, eq, inArray, asc, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db, runInTenant, type Tx } from "@/db"
import { requireContext, assertCan, type ServerContext } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import { PERMISSIONS, permLabel } from "@/lib/permissions"
import {
  activateMembership,
  disableOrRemoveMembership,
  normalizeSeatEmail,
  releaseInvitation,
  reserveInvitation,
} from "@/lib/deployment-seats"
import {
  member,
  membershipProfiles,
  memberRoles,
  roles,
  rolePermissions,
  permissions,
  user,
  session,
  pendingInvites,
} from "@/db/schema"

/**
 * True if `memberId` is the only ACTIVE member holding the system "Owner" role
 * in the current tenant. Used to refuse demoting/disabling/removing the last
 * Owner (which would orphan the tenant). Must run inside the tenant tx.
 */
async function isLastOwner(tx: Tx, memberId: string): Promise<boolean> {
  const owners = await tx
    .select({ memberId: membershipProfiles.memberId })
    .from(membershipProfiles)
    .innerJoin(roles, eq(membershipProfiles.roleId, roles.id))
    .where(
      and(
        eq(roles.name, "Owner"),
        eq(roles.isSystem, true),
        eq(membershipProfiles.status, "active")
      )
    )
  return owners.length === 1 && owners[0].memberId === memberId
}

/**
 * Privilege-escalation guard for role assignment. A non-superadmin may only
 * assign a role whose every permission key they themselves hold — mirrors
 * `setRolePermissions`' subset check so an actor can't confer (via a role) a
 * permission they lack. Names the first withheld permission on rejection.
 * Must run inside the tenant tx.
 */
async function assertCanAssignRole(
  tx: Tx,
  ctx: ServerContext,
  roleId: string
): Promise<void> {
  if (ctx.isSuperadmin) return
  const rows = await tx
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId))
  const illegal = rows.find((r) => !ctx.permissions.has(r.key))
  if (illegal) {
    throw new Error(
      `You can't assign a role that grants a permission you don't hold yourself: "${permLabel(illegal.key)}".`
    )
  }
}

// ─── View shapes ─────────────────────────────────────────────────────────────

export type TeamMemberView = {
  memberId: string
  name: string
  email: string
  /** Legacy "primary" role (first of `roleIds`); kept for back-compat display. */
  roleId: string | null
  roleName: string | null
  /** Every role assigned to this member — access = the union of these grids. */
  roleIds: string[]
  roleNames: string[]
  managerMemberId: string | null
  managerName: string | null
  status: string
  /** Stamped on each sign-in. Null if the user has never logged in. */
  lastLoginAt: Date | null
  /** Approximate — newest session refresh (session.updatedAt, ~daily precision). */
  lastActiveAt: Date | null
}

export type TeamRoleView = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  tierLevel: number
  memberCount: number
  permissionCount: number
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Every member of the active tenant joined to their profile + role.
 * member/user are NOT RLS — query with `db`, filtered by organizationId.
 * membershipProfiles/roles ARE RLS — read them inside `runInTenant`.
 */
export async function listTeamMembers(): Promise<TeamMemberView[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  // member + user (not RLS).
  const memberRows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      lastLoginAt: user.lastLoginAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))

  // Approximate "last active" = newest session refresh per user (session is not
  // RLS). session.updatedAt bumps ~daily, so this is a coarse recency signal.
  const userIds = memberRows.map((m) => m.userId)
  const activeRows = userIds.length
    ? await db
        .select({
          userId: session.userId,
          lastActiveAt: sql<Date | null>`max(${session.updatedAt})`,
        })
        .from(session)
        .where(inArray(session.userId, userIds))
        .groupBy(session.userId)
    : []
  const lastActiveByUser = new Map(activeRows.map((r) => [r.userId, r.lastActiveAt]))

  // membership profiles + roles + role assignments (RLS).
  const { profiles, roleRows, assignments } = await runInTenant(
    ctx.tenantId,
    async (tx) => {
      const profiles = await tx
        .select({
          memberId: membershipProfiles.memberId,
          roleId: membershipProfiles.roleId,
          managerMemberId: membershipProfiles.managerMemberId,
          status: membershipProfiles.status,
        })
        .from(membershipProfiles)
      const roleRows = await tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
      const assignments = await tx
        .select({ memberId: memberRoles.memberId, roleId: memberRoles.roleId })
        .from(memberRoles)
      return { profiles, roleRows, assignments }
    }
  )

  const profileByMember = new Map(profiles.map((p) => [p.memberId, p]))
  const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]))
  const nameByMember = new Map(memberRows.map((m) => [m.memberId, m.name]))
  // member → assigned role ids (from the many-to-many join).
  const rolesByMember = new Map<string, string[]>()
  for (const a of assignments) {
    const arr = rolesByMember.get(a.memberId) ?? []
    arr.push(a.roleId)
    rolesByMember.set(a.memberId, arr)
  }

  return memberRows
    .map((m) => {
      const p = profileByMember.get(m.memberId)
      // Prefer the join table; fall back to the legacy single primary role.
      let roleIds = rolesByMember.get(m.memberId) ?? []
      if (roleIds.length === 0 && p?.roleId) roleIds = [p.roleId]
      // Stable, name-sorted for display.
      roleIds = [...roleIds].sort((a, b) =>
        (roleNameById.get(a) ?? "").localeCompare(roleNameById.get(b) ?? "")
      )
      const roleNames = roleIds.map((id) => roleNameById.get(id) ?? "").filter(Boolean)
      const managerMemberId = p?.managerMemberId ?? null
      return {
        memberId: m.memberId,
        name: m.name,
        email: m.email,
        roleId: roleIds[0] ?? null,
        roleName: roleNames[0] ?? null,
        roleIds,
        roleNames,
        managerMemberId,
        managerName: managerMemberId
          ? nameByMember.get(managerMemberId) ?? null
          : null,
        status: p?.status ?? "active",
        lastLoginAt: m.lastLoginAt ?? null,
        lastActiveAt: lastActiveByUser.get(m.userId) ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Roles for the tenant, with member + permission counts. */
export async function listTeamRoles(): Promise<TeamRoleView[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  return runInTenant(ctx.tenantId, async (tx) => {
    const roleRows = await tx
      .select()
      .from(roles)
      .where(eq(roles.tenantId, ctx.tenantId))
      .orderBy(sql`${roles.defaultTierLevel} desc`, asc(roles.name))

    const memberCounts = await tx
      .select({
        roleId: membershipProfiles.roleId,
        count: sql<number>`count(*)::int`,
      })
      .from(membershipProfiles)
      .groupBy(membershipProfiles.roleId)

    const permCounts = await tx
      .select({
        roleId: rolePermissions.roleId,
        count: sql<number>`count(*)::int`,
      })
      .from(rolePermissions)
      .groupBy(rolePermissions.roleId)

    const memberCountByRole = new Map(
      memberCounts.map((r) => [r.roleId, Number(r.count)])
    )
    const permCountByRole = new Map(
      permCounts.map((r) => [r.roleId, Number(r.count)])
    )

    return roleRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      tierLevel: r.defaultTierLevel,
      memberCount: memberCountByRole.get(r.id) ?? 0,
      permissionCount: permCountByRole.get(r.id) ?? 0,
    }))
  })
}

export type RoleWithPermissions = TeamRoleView & { permissions: string[] }

/** All roles with their granted permission keys — for the roles page. */
export async function listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)
  const roleViews = await listTeamRoles()
  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ roleId: rolePermissions.roleId, key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    const byRole = new Map<string, string[]>()
    for (const r of rows) {
      const arr = byRole.get(r.roleId) ?? []
      arr.push(r.key)
      byRole.set(r.roleId, arr)
    }
    return roleViews.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] }))
  })
}

export type PermissionAdmin = { memberId: string; name: string; roleNames: string[] }

/**
 * Active members who can configure roles/permissions — i.e. whose effective
 * (union-of-roles) grants include `tenant.manage_roles`. Surfaced on the roles
 * page so it's clear WHO is able to change permissions.
 */
export async function listPermissionAdmins(): Promise<PermissionAdmin[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  const { assignments, adminRoleIds, roleNameById } = await runInTenant(
    ctx.tenantId,
    async (tx) => {
      // Roles that grant the "Manage roles" permission.
      const adminRoles = await tx
        .select({ roleId: rolePermissions.roleId })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(permissions.key, PERMISSIONS.TENANT_MANAGE_ROLES))
      const adminRoleIds = new Set(adminRoles.map((r) => r.roleId))

      const roleRows = await tx.select({ id: roles.id, name: roles.name }).from(roles)
      const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]))

      // Every member→role assignment (union model), plus the legacy primary.
      const mr = await tx
        .select({ memberId: memberRoles.memberId, roleId: memberRoles.roleId })
        .from(memberRoles)
      const profiles = await tx
        .select({
          memberId: membershipProfiles.memberId,
          roleId: membershipProfiles.roleId,
          status: membershipProfiles.status,
        })
        .from(membershipProfiles)
      const activeMembers = new Set(
        profiles.filter((p) => p.status === "active").map((p) => p.memberId)
      )
      const assignments = new Map<string, Set<string>>()
      for (const row of mr) {
        if (!activeMembers.has(row.memberId)) continue
        const set = assignments.get(row.memberId) ?? new Set<string>()
        set.add(row.roleId)
        assignments.set(row.memberId, set)
      }
      // Legacy fallback: members with a primary role but no member_roles rows.
      for (const p of profiles) {
        if (!p.roleId || !activeMembers.has(p.memberId)) continue
        if (!assignments.has(p.memberId)) {
          assignments.set(p.memberId, new Set([p.roleId]))
        }
      }
      return { assignments, adminRoleIds, roleNameById }
    }
  )

  // Names come from user (not RLS), filtered to this tenant's members.
  const memberRows = await db
    .select({ memberId: member.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))
  const nameByMember = new Map(memberRows.map((m) => [m.memberId, m.name]))

  const admins: PermissionAdmin[] = []
  for (const [memberId, roleIds] of assignments) {
    const adminRoles = [...roleIds].filter((id) => adminRoleIds.has(id))
    if (adminRoles.length === 0) continue
    admins.push({
      memberId,
      name: nameByMember.get(memberId) ?? "—",
      roleNames: adminRoles.map((id) => roleNameById.get(id) ?? "—").sort(),
    })
  }
  return admins.sort((a, b) => a.name.localeCompare(b.name))
}

/** Permission keys currently granted to a role. */
export async function getRolePermissions(roleId: string): Promise<string[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId))
    return rows.map((r) => r.key)
  })
}

// ─── Role mutations ──────────────────────────────────────────────────────────

/** Replace the full permission set for a role. */
export async function setRolePermissions(
  roleId: string,
  keys: string[]
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)

    await runInTenant(ctx.tenantId, async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId)))
        .limit(1)
      if (!role) throw new Error("Role not found.")

      // System roles are immutable templates.
      if (role.isSystem) {
        throw new Error("System roles' permissions can't be edited.")
      }

      if (!ctx.isSuperadmin) {
        // You can't edit the permissions of the role you yourself hold
        // (would let you grant yourself anything indirectly).
        if (ctx.memberId) {
          const [mine] = await tx
            .select({ roleId: membershipProfiles.roleId })
            .from(membershipProfiles)
            .where(eq(membershipProfiles.memberId, ctx.memberId))
            .limit(1)
          if (mine?.roleId && mine.roleId === roleId) {
            throw new Error("You can't edit your own role's permissions.")
          }
        }

        // You may only ADD/REMOVE permission keys you hold yourself. Keys
        // already on the role that you don't hold are left untouched.
        const currentRows = await tx
          .select({ key: permissions.key })
          .from(rolePermissions)
          .innerJoin(
            permissions,
            eq(rolePermissions.permissionId, permissions.id)
          )
          .where(eq(rolePermissions.roleId, roleId))
        const current = new Set(currentRows.map((r) => r.key))
        const next = new Set(keys)
        const changed = [
          ...[...next].filter((k) => !current.has(k)),
          ...[...current].filter((k) => !next.has(k)),
        ]
        const illegal = changed.filter((k) => !ctx.permissions.has(k))
        if (illegal.length) {
          throw new Error(
            `You can only grant or revoke permissions you hold yourself — "${permLabel(illegal[0])}" is not one of yours.`
          )
        }
      }

      const unique = Array.from(new Set(keys))
      const permRows = unique.length
        ? await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, unique))
        : []

      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId))

      if (permRows.length) {
        await tx.insert(rolePermissions).values(
          permRows.map((p) => ({
            tenantId: ctx.tenantId,
            roleId,
            permissionId: p.id,
          }))
        )
      }

      await writeAudit(tx, ctx, {
        action: "role.permissions_set",
        entityType: "role",
        entityId: roleId,
        after: { permissions: unique },
      })
    })

    revalidatePath("/team")
  })
}

function validateRoleInput(name: string) {
  if (name.trim().length === 0) throw new Error("Role name is required.")
}

export async function createRole(input: {
  name: string
  /** Legacy seniority tier — dormant (access is now the union of role grids). */
  tier?: number
}): Promise<ActionResult<TeamRoleView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)
    validateRoleInput(input.name)

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const name = input.name.trim()
      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.name, name)))
        .limit(1)
      if (existing) throw new Error("A role with that name already exists.")

      const [created] = await tx
        .insert(roles)
        .values({
          tenantId: ctx.tenantId,
          name,
          defaultTierLevel: input.tier ?? 0,
          isSystem: false,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "role.created",
        entityType: "role",
        entityId: created.id,
        after: { name: created.name, tierLevel: created.defaultTierLevel },
      })
      return {
        id: created.id,
        name: created.name,
        description: created.description,
        isSystem: created.isSystem,
        tierLevel: created.defaultTierLevel,
        memberCount: 0,
        permissionCount: 0,
      }
    })

    revalidatePath("/team")
    return view
  })
}

export async function updateRole(
  id: string,
  input: { name: string; tier?: number }
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)
  validateRoleInput(input.name)

  await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")

    const name = input.name.trim()
    // System roles are immutable templates: they can't be renamed.
    if (role.isSystem && name !== role.name) {
      throw new Error("System roles can't be renamed.")
    }

    if (name !== role.name) {
      const [clash] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.name, name)))
        .limit(1)
      if (clash) throw new Error("A role with that name already exists.")
    }

    await tx
      .update(roles)
      .set({
        name: role.isSystem ? role.name : name,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id))

    await writeAudit(tx, ctx, {
      action: "role.updated",
      entityType: "role",
      entityId: id,
      before: { name: role.name },
      after: {
        name: role.isSystem ? role.name : name,
      },
    })
  })

  revalidatePath("/team")
  })
}

export async function deleteRole(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)

  await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")
    if (role.isSystem) throw new Error("System roles can't be deleted.")

    const [inUse] = await tx
      .select({ id: membershipProfiles.id })
      .from(membershipProfiles)
      .where(eq(membershipProfiles.roleId, id))
      .limit(1)
    if (inUse) throw new Error("Role is in use")

    await tx.delete(roles).where(eq(roles.id, id))

    await writeAudit(tx, ctx, {
      action: "role.deleted",
      entityType: "role",
      entityId: id,
      before: { name: role.name, tierLevel: role.defaultTierLevel },
    })
  })

  revalidatePath("/team")
  })
}

// ─── Member mutations ────────────────────────────────────────────────────────

export async function addMember(input: {
  email: string
  roleId: string
}): Promise<ActionResult<{ invited: boolean }>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  const rawEmail = input.email ?? ""
  if (!rawEmail.trim()) throw new Error("Email is required.")
  const email = normalizeSeatEmail(rawEmail)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.")
  }
  if (!input.roleId) throw new Error("Pick a role.")

  // Find a user by email (case-insensitive). user is not RLS.
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1)

  // Already a member of this tenant? (member is not RLS.)
  if (u) {
    const [existingMember] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.userId, u.id), eq(member.organizationId, ctx.tenantId))
      )
      .limit(1)
    if (existingMember) throw new Error("Already a member.")
  }

  // Validate the role (tenant ownership, tier ceiling, permission subset)
  // BEFORE creating the member row — a failed insert below would otherwise
  // leave a profile-less but `active`-resolving member (an unintended foothold).
  const roleTier = await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, tier: roles.defaultTierLevel })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")
    // Can't confer (via a role) a permission the actor doesn't hold.
    await assertCanAssignRole(tx, ctx, input.roleId)
    return role.tier
  })

  // No user with that email yet: record a PENDING INVITE that the auth hooks
  // consume on their first sign-in (creating the member + profile with this
  // role/tier). Upsert so re-inviting updates the role/tier.
  if (!u) {
    await reserveInvitation({
      tenantId: ctx.tenantId,
      email,
      roleId: input.roleId,
      tierLevel: roleTier,
      invitedByMemberId: ctx.memberId,
      actor: { userId: ctx.userId, memberId: ctx.memberId },
    })
    revalidatePath("/team")
    return { invited: true }
  }

  await activateMembership({
    tenantId: ctx.tenantId,
    userId: u.id,
    roleId: input.roleId,
    tierLevel: roleTier,
    actor: { userId: ctx.userId, memberId: ctx.memberId },
  })

  revalidatePath("/team")
  return { invited: false }
  })
}

export type PendingInviteView = {
  id: string
  email: string
  roleName: string | null
  tierLevel: number
  invitedByName: string | null
  createdAt: Date
}

/** Invites awaiting the person's first sign-in, newest first. */
export async function listPendingInvites(): Promise<PendingInviteView[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)
  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: pendingInvites.id,
        email: pendingInvites.email,
        roleName: roles.name,
        tierLevel: pendingInvites.tierLevel,
        invitedByName: user.name,
        createdAt: pendingInvites.createdAt,
      })
      .from(pendingInvites)
      .leftJoin(roles, eq(pendingInvites.roleId, roles.id))
      .leftJoin(member, eq(pendingInvites.invitedByMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .orderBy(sql`${pendingInvites.createdAt} desc`)
    return rows
  })
}

export async function revokePendingInvite(
  id: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)
    await releaseInvitation({
      tenantId: ctx.tenantId,
      invitationId: id,
      actor: { userId: ctx.userId, memberId: ctx.memberId },
    })
    revalidatePath("/team")
  })
}

export async function updateMember(
  memberId: string,
  input: {
    /** Full set of roles for the member (many-to-many). Union = effective access. */
    roleIds?: string[]
    managerMemberId?: string | null
  }
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  if (input.managerMemberId && input.managerMemberId === memberId) {
    throw new Error("A member can't manage themselves.")
  }

  const isSelf = ctx.memberId === memberId

  await runInTenant(ctx.tenantId, async (tx) => {
    const [target] = await tx
      .select({ managerMemberId: membershipProfiles.managerMemberId })
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))
      .limit(1)
    if (!target) throw new Error("Member profile not found.")

    // ── Roles (many-to-many) ─────────────────────────────────────────────
    if (input.roleIds !== undefined) {
      if (isSelf && !ctx.isSuperadmin) {
        throw new Error("You can't change your own roles.")
      }
      // Every role must belong to this tenant, and you can't confer (via a
      // role) a permission you don't hold yourself.
      const found = input.roleIds.length
        ? await tx
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(inArray(roles.id, input.roleIds), eq(roles.tenantId, ctx.tenantId))
            )
        : []
      const valid = new Set(found.map((r) => r.id))
      for (const rid of input.roleIds) {
        if (!valid.has(rid)) throw new Error("Role not found.")
        await assertCanAssignRole(tx, ctx, rid)
      }
      // Protect the last Owner: can't strip the Owner role off the last owner.
      const [ownerRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(
            eq(roles.name, "Owner"),
            eq(roles.isSystem, true),
            eq(roles.tenantId, ctx.tenantId)
          )
        )
        .limit(1)
      if (
        ownerRole &&
        !input.roleIds.includes(ownerRole.id) &&
        (await isLastOwner(tx, memberId))
      ) {
        throw new Error("You can't remove the Owner role from the last Owner.")
      }

      await tx.delete(memberRoles).where(eq(memberRoles.memberId, memberId))
      if (input.roleIds.length) {
        await tx.insert(memberRoles).values(
          input.roleIds.map((roleId) => ({
            tenantId: ctx.tenantId,
            memberId,
            roleId,
          }))
        )
      }
      // Keep the legacy primary role_id in sync (first role) for back-compat.
      await tx
        .update(membershipProfiles)
        .set({ roleId: input.roleIds[0] ?? null, updatedAt: new Date() })
        .where(eq(membershipProfiles.memberId, memberId))
    }

    // ── Reporting line (manager) ─────────────────────────────────────────
    if (input.managerMemberId !== undefined) {
      if (input.managerMemberId) {
        const [mgr] = await tx
          .select({ status: membershipProfiles.status })
          .from(membershipProfiles)
          .where(eq(membershipProfiles.memberId, input.managerMemberId))
          .limit(1)
        if (!mgr || mgr.status !== "active") {
          throw new Error("Manager must be an active member of this organization.")
        }
        // No cycles: walking UP from the proposed manager must never reach the edited member.
        const uplines = await tx
          .select({
            memberId: membershipProfiles.memberId,
            managerId: membershipProfiles.managerMemberId,
          })
          .from(membershipProfiles)
        const managerOf = new Map(uplines.map((r) => [r.memberId, r.managerId]))
        const seen = new Set<string>()
        let cursor: string | null = input.managerMemberId
        while (cursor) {
          if (cursor === memberId) {
            throw new Error("That manager assignment would create a reporting cycle.")
          }
          if (seen.has(cursor)) break
          seen.add(cursor)
          cursor = managerOf.get(cursor) ?? null
        }
      }
      await tx
        .update(membershipProfiles)
        .set({ managerMemberId: input.managerMemberId, updatedAt: new Date() })
        .where(eq(membershipProfiles.memberId, memberId))
    }

    await writeAudit(tx, ctx, {
      action: "member.updated",
      entityType: "member",
      entityId: memberId,
      after: { roleIds: input.roleIds, managerMemberId: input.managerMemberId },
    })
  })

  revalidatePath("/team")
  })
}

/**
 * Activate or disable a member without deleting them. A disabled member keeps
 * their row/history but gets zero effective permissions (enforced in
 * getServerContext), so access is revoked immediately and reversibly.
 */
export async function setMemberStatus(
  memberId: string,
  status: "active" | "disabled"
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  if (status !== "active" && status !== "disabled") {
    throw new Error("Invalid member status.")
  }
  if (ctx.memberId && ctx.memberId === memberId) {
    throw new Error("You can't change your own status.")
  }

  const memberRow = await runInTenant(ctx.tenantId, async (tx) => {
    const [profile] = await tx
      .select({
        status: membershipProfiles.status,
        roleId: membershipProfiles.roleId,
        tierLevel: membershipProfiles.tierLevel,
      })
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))
      .limit(1)
    if (!profile) throw new Error("Member profile not found.")
    return profile
  })

  if (status === "active" && memberRow.status !== "active") {
    const [target] = await db.select({ userId: member.userId }).from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, ctx.tenantId))).limit(1)
    if (!target) throw new Error("Member profile not found.")
    await activateMembership({
      tenantId: ctx.tenantId,
      memberId,
      userId: target.userId,
      roleId: memberRow.roleId,
      tierLevel: memberRow.tierLevel,
      actor: { userId: ctx.userId, memberId: ctx.memberId },
    })
  } else if (status === "disabled" && memberRow.status !== "disabled") {
    await disableOrRemoveMembership({
      tenantId: ctx.tenantId,
      memberId,
      remove: false,
      actor: { userId: ctx.userId, memberId: ctx.memberId },
    })
  }

  revalidatePath("/team")
  })
}

export async function removeMember(memberId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  if (ctx.memberId && ctx.memberId === memberId) {
    throw new Error("You can't remove yourself.")
  }

  await disableOrRemoveMembership({
    tenantId: ctx.tenantId,
    memberId,
    remove: true,
    actor: { userId: ctx.userId, memberId: ctx.memberId },
  })

  revalidatePath("/team")
  })
}
