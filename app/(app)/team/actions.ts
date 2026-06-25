"use server"

import { and, eq, inArray, asc, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db, runInTenant } from "@/db"
import { requireContext, assertCan } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  member,
  membershipProfiles,
  roles,
  rolePermissions,
  permissions,
  user,
} from "@/db/schema"

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
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))

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
): Promise<void> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_ROLES)

  await runInTenant(ctx.tenantId, async (tx) => {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")

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
  })

  revalidatePath("/team")
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
}): Promise<TeamRoleView> {
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
}

export async function updateRole(
  id: string,
  input: { name: string; tier: number }
): Promise<void> {
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
    // System roles can have their tier edited but not be renamed.
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
        defaultTierLevel: input.tier,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id))
  })

  revalidatePath("/team")
}

export async function deleteRole(id: string): Promise<void> {
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
  })

  revalidatePath("/team")
}

// ─── Member mutations ────────────────────────────────────────────────────────

export async function addMember(input: {
  email: string
  roleId: string
  tier: number
}): Promise<void> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  const email = (input.email ?? "").trim()
  if (email.length === 0) throw new Error("Email is required.")
  if (!input.roleId) throw new Error("Pick a role.")
  if (!Number.isInteger(input.tier) || input.tier < 0) {
    throw new Error("Tier must be a non-negative integer.")
  }

  // Find a user by email (case-insensitive). user is not RLS.
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
    .limit(1)
  if (!u) {
    throw new Error(
      "No user with that email has signed in yet — ask them to sign in once, then add them."
    )
  }

  // Already a member of this tenant? (member is not RLS.)
  const [existingMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, u.id), eq(member.organizationId, ctx.tenantId))
    )
    .limit(1)
  if (existingMember) throw new Error("Already a member.")

  const memberId = crypto.randomUUID()
  await db.insert(member).values({
    id: memberId,
    organizationId: ctx.tenantId,
    userId: u.id,
    role: "member",
  })

  await runInTenant(ctx.tenantId, async (tx) => {
    // Validate the role belongs to this tenant.
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.tenantId, ctx.tenantId)))
      .limit(1)
    if (!role) throw new Error("Role not found.")

    await tx.insert(membershipProfiles).values({
      memberId,
      tenantId: ctx.tenantId,
      roleId: input.roleId,
      tierLevel: input.tier,
      status: "active",
    })
  })

  revalidatePath("/team")
}

export async function updateMember(
  memberId: string,
  input: {
    roleId?: string | null
    tierLevel?: number
    managerMemberId?: string | null
  }
): Promise<void> {
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

  await runInTenant(ctx.tenantId, async (tx) => {
    if (input.roleId) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(eq(roles.id, input.roleId), eq(roles.tenantId, ctx.tenantId))
        )
        .limit(1)
      if (!role) throw new Error("Role not found.")
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
  })

  revalidatePath("/team")
}

export async function removeMember(memberId: string): Promise<void> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)

  if (ctx.memberId && ctx.memberId === memberId) {
    throw new Error("You can't remove yourself.")
  }

  // Delete the RLS-scoped profile inside the tenant transaction.
  await runInTenant(ctx.tenantId, async (tx) => {
    await tx
      .delete(membershipProfiles)
      .where(eq(membershipProfiles.memberId, memberId))
  })

  // member is not RLS — scope the delete to the active tenant.
  await db
    .delete(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, ctx.tenantId))
    )

  revalidatePath("/team")
}
