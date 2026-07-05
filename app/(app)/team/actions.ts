"use server"

import { and, eq, inArray, asc, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db, runInTenant, type Tx } from "@/db"
import { requireContext, assertCan, type ServerContext } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import { PERMISSIONS, permLabel } from "@/lib/permissions"
import {
  member,
  membershipProfiles,
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
  roleId: string | null
  roleName: string | null
  tierLevel: number
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

  // membership profiles + roles (RLS).
  const { profiles, roleRows } = await runInTenant(ctx.tenantId, async (tx) => {
    const profiles = await tx
      .select({
        memberId: membershipProfiles.memberId,
        roleId: membershipProfiles.roleId,
        tierLevel: membershipProfiles.tierLevel,
        managerMemberId: membershipProfiles.managerMemberId,
        status: membershipProfiles.status,
      })
      .from(membershipProfiles)
    const roleRows = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
    return { profiles, roleRows }
  })

  const profileByMember = new Map(profiles.map((p) => [p.memberId, p]))
  const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]))
  const nameByMember = new Map(memberRows.map((m) => [m.memberId, m.name]))

  return memberRows
    .map((m) => {
      const p = profileByMember.get(m.memberId)
      const roleId = p?.roleId ?? null
      const managerMemberId = p?.managerMemberId ?? null
      return {
        memberId: m.memberId,
        name: m.name,
        email: m.email,
        roleId,
        roleName: roleId ? roleNameById.get(roleId) ?? null : null,
        tierLevel: p?.tierLevel ?? 0,
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

function validateRoleInput(name: string, tier: number) {
  if (name.trim().length === 0) throw new Error("Role name is required.")
  if (!Number.isInteger(tier) || tier < 0) {
    throw new Error("Tier must be a non-negative integer.")
  }
}

export async function createRole(input: {
  name: string
  tier: number
}): Promise<ActionResult<TeamRoleView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)
    validateRoleInput(input.name, input.tier)

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
          defaultTierLevel: input.tier,
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
  input: { name: string; tier: number }
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)
  validateRoleInput(input.name, input.tier)

  await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")

    const name = input.name.trim()
    // System roles are immutable templates: neither renamed nor re-tiered.
    if (role.isSystem && name !== role.name) {
      throw new Error("System roles can't be renamed.")
    }
    if (role.isSystem && input.tier !== role.defaultTierLevel) {
      throw new Error("System roles' tier can't be changed.")
    }
    // Tier ceiling: a non-superadmin can't set a role's tier above their own
    // (otherwise they could mint a role that outranks them and assign it).
    if (!ctx.isSuperadmin && input.tier > ctx.tierLevel) {
      throw new Error("You can't set a role tier above your own.")
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
        defaultTierLevel: role.isSystem ? role.defaultTierLevel : input.tier,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id))

    await writeAudit(tx, ctx, {
      action: "role.updated",
      entityType: "role",
      entityId: id,
      before: { name: role.name, tierLevel: role.defaultTierLevel },
      after: {
        name: role.isSystem ? role.name : name,
        tierLevel: role.isSystem ? role.defaultTierLevel : input.tier,
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
  tier: number
}): Promise<ActionResult<{ invited: boolean }>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  const email = (input.email ?? "").trim()
  if (email.length === 0) throw new Error("Email is required.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.")
  }
  if (!input.roleId) throw new Error("Pick a role.")
  if (!Number.isInteger(input.tier) || input.tier < 0) {
    throw new Error("Tier must be a non-negative integer.")
  }
  // Tier ceiling: a non-superadmin can't grant a seniority tier above their own.
  if (!ctx.isSuperadmin && input.tier > ctx.tierLevel) {
    throw new Error("You can't assign a tier above your own.")
  }

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
  await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, defaultTierLevel: roles.defaultTierLevel })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")
    // Role ceiling: can't grant a role whose tier outranks the actor.
    if (!ctx.isSuperadmin && role.defaultTierLevel > ctx.tierLevel) {
      throw new Error("You can't assign a role above your own tier.")
    }
    // Can't confer (via a role) a permission the actor doesn't hold.
    await assertCanAssignRole(tx, ctx, input.roleId)
  })

  // No user with that email yet: record a PENDING INVITE that the auth hooks
  // consume on their first sign-in (creating the member + profile with this
  // role/tier). Upsert so re-inviting updates the role/tier.
  if (!u) {
    await runInTenant(ctx.tenantId, async (tx) => {
      // Delete-then-insert (the unique index is on an expression —
      // lower(email) — which ON CONFLICT targeting can't name via the ORM).
      await tx
        .delete(pendingInvites)
        .where(
          and(
            eq(pendingInvites.tenantId, ctx.tenantId),
            sql`lower(${pendingInvites.email}) = lower(${email})`
          )
        )
      await tx.insert(pendingInvites).values({
        tenantId: ctx.tenantId,
        email,
        roleId: input.roleId,
        tierLevel: input.tier,
        invitedByMemberId: ctx.memberId,
      })
      await writeAudit(tx, ctx, {
        action: "member.invited",
        entityType: "pending_invite",
        entityId: email,
        after: { email, roleId: input.roleId, tierLevel: input.tier },
      })
    })
    revalidatePath("/team")
    return { invited: true }
  }

  const memberId = crypto.randomUUID()
  await db.insert(member).values({
    id: memberId,
    organizationId: ctx.tenantId,
    userId: u.id,
    role: "member",
  })
  // A direct add supersedes any pending invite for the same email.
  await runInTenant(ctx.tenantId, (tx) =>
    tx
      .delete(pendingInvites)
      .where(
        and(
          eq(pendingInvites.tenantId, ctx.tenantId),
          sql`lower(${pendingInvites.email}) = lower(${email})`
        )
      )
  )

  // Insert the profile; if it fails, compensate by removing the orphan member
  // row so we never leave a profile-less active member behind.
  try {
    await runInTenant(ctx.tenantId, async (tx) => {
      await tx.insert(membershipProfiles).values({
        memberId,
        tenantId: ctx.tenantId,
        roleId: input.roleId,
        tierLevel: input.tier,
        status: "active",
      })

      await writeAudit(tx, ctx, {
        action: "member.added",
        entityType: "member",
        entityId: memberId,
        after: { email, roleId: input.roleId, tierLevel: input.tier },
      })
    })
  } catch (err) {
    await db
      .delete(member)
      .where(
        and(eq(member.id, memberId), eq(member.organizationId, ctx.tenantId))
      )
    throw err
  }

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
    await runInTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .delete(pendingInvites)
        .where(eq(pendingInvites.id, id))
        .returning({ email: pendingInvites.email })
      if (!row) throw new Error("Invite not found.")
      await writeAudit(tx, ctx, {
        action: "member.invite_revoked",
        entityType: "pending_invite",
        entityId: row.email,
      })
    })
    revalidatePath("/team")
  })
}

export async function updateMember(
  memberId: string,
  input: {
    roleId?: string | null
    tierLevel?: number
    managerMemberId?: string | null
  }
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  if (
    input.tierLevel !== undefined &&
    (!Number.isInteger(input.tierLevel) || input.tierLevel < 0)
  ) {
    throw new Error("Tier must be a non-negative integer.")
  }
  if (input.managerMemberId && input.managerMemberId === memberId) {
    throw new Error("A member can't manage themselves.")
  }

  const isSelf = ctx.memberId === memberId

  await runInTenant(ctx.tenantId, async (tx) => {
    // Load the target's current profile so we can enforce tier ceilings.
    const [target] = await tx
      .select({
        roleId: membershipProfiles.roleId,
        tierLevel: membershipProfiles.tierLevel,
        managerMemberId: membershipProfiles.managerMemberId,
      })
      .from(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))
      .limit(1)
    if (!target) throw new Error("Member profile not found.")

    // Resolve the role being assigned (if any) within this tenant.
    let newRole: { id: string; defaultTierLevel: number } | null = null
    if (input.roleId) {
      const [role] = await tx
        .select({ id: roles.id, defaultTierLevel: roles.defaultTierLevel })
        .from(roles)
        .where(
          and(eq(roles.id, input.roleId), eq(roles.tenantId, ctx.tenantId))
        )
        .limit(1)
      if (!role) throw new Error("Role not found.")
      newRole = role
    }

    // ── Escalation guards (superadmin bypasses) ──────────────────────────
    if (!ctx.isSuperadmin) {
      const changingRole =
        input.roleId !== undefined && input.roleId !== target.roleId
      const changingTier =
        input.tierLevel !== undefined && input.tierLevel !== target.tierLevel

      // No self-promotion: you can't change your own role or tier.
      if (isSelf && (changingRole || changingTier)) {
        throw new Error("You can't change your own role or tier.")
      }
      // You can't edit a member who already sits at or above your tier.
      if (!isSelf && target.tierLevel >= ctx.tierLevel) {
        throw new Error("You can't edit a member at or above your own tier.")
      }
      // You can't assign a tier above your own.
      if (input.tierLevel !== undefined && input.tierLevel > ctx.tierLevel) {
        throw new Error("You can't assign a tier above your own.")
      }
      // You can't assign a role whose tier outranks you.
      if (newRole && newRole.defaultTierLevel > ctx.tierLevel) {
        throw new Error("You can't assign a role above your own tier.")
      }
    }

    // Can't confer (via the assigned role) a permission the actor lacks.
    // Runs only when the role actually changes; superadmin bypasses internally.
    if (newRole && input.roleId !== target.roleId) {
      await assertCanAssignRole(tx, ctx, newRole.id)
    }

    // A manager must resolve to an active membership profile in THIS tenant
    // (membershipProfiles is RLS-scoped, so a foreign id simply won't be found).
    if (input.managerMemberId) {
      const [mgr] = await tx
        .select({ status: membershipProfiles.status })
        .from(membershipProfiles)
        .where(eq(membershipProfiles.memberId, input.managerMemberId))
        .limit(1)
      if (!mgr || mgr.status !== "active") {
        throw new Error(
          "Manager must be an active member of this organization."
        )
      }

      // No cycles: walking UP from the proposed manager must never reach the
      // member being edited (A→B→A would make both see each other's records
      // via the managed-subtree scope and break upline approval routing).
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
          throw new Error(
            "That manager assignment would create a reporting cycle."
          )
        }
        if (seen.has(cursor)) break // pre-existing cycle upstream; don't loop
        seen.add(cursor)
        cursor = managerOf.get(cursor) ?? null
      }
    }

    // Protect the last Owner: refuse to demote them off the Owner role.
    if (
      input.roleId !== undefined &&
      input.roleId !== target.roleId &&
      (await isLastOwner(tx, memberId))
    ) {
      throw new Error("You can't change the role of the last Owner.")
    }

    const set: Partial<typeof membershipProfiles.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (input.roleId !== undefined) set.roleId = input.roleId
    if (input.tierLevel !== undefined) set.tierLevel = input.tierLevel
    if (input.managerMemberId !== undefined) {
      set.managerMemberId = input.managerMemberId
    }

    const [updated] = await tx
      .update(membershipProfiles)
      .set(set)
      .where(eq(membershipProfiles.memberId, memberId))
      .returning({ id: membershipProfiles.id })
    if (!updated) throw new Error("Member profile not found.")

    await writeAudit(tx, ctx, {
      action: "member.updated",
      entityType: "member",
      entityId: memberId,
      before: {
        roleId: target.roleId,
        tierLevel: target.tierLevel,
        managerMemberId: target.managerMemberId,
      },
      after: {
        roleId: input.roleId ?? target.roleId,
        tierLevel: input.tierLevel ?? target.tierLevel,
        managerMemberId:
          input.managerMemberId !== undefined
            ? input.managerMemberId
            : target.managerMemberId,
      },
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

  await runInTenant(ctx.tenantId, async (tx) => {
    // Don't let the last Owner be disabled (would orphan the tenant).
    if (status === "disabled" && (await isLastOwner(tx, memberId))) {
      throw new Error("You can't disable the last Owner.")
    }
    const [updated] = await tx
      .update(membershipProfiles)
      .set({ status, updatedAt: new Date() })
      .where(eq(membershipProfiles.memberId, memberId))
      .returning({ id: membershipProfiles.id })
    if (!updated) throw new Error("Member profile not found.")

    await writeAudit(tx, ctx, {
      action: "member.status_changed",
      entityType: "member",
      entityId: memberId,
      after: { status },
    })
  })

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

  // Delete the RLS-scoped profile inside the tenant transaction.
  await runInTenant(ctx.tenantId, async (tx) => {
    if (await isLastOwner(tx, memberId)) {
      throw new Error("You can't remove the last Owner.")
    }
    await tx
      .delete(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))

    await writeAudit(tx, ctx, {
      action: "member.removed",
      entityType: "member",
      entityId: memberId,
    })
  })

  // member is not RLS — scope the delete to the active tenant.
  await db
    .delete(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, ctx.tenantId))
    )

  revalidatePath("/team")
  })
}
