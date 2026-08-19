"use server"

import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db, runInTenant } from "@/db"
import {
  organization,
  roles,
  member,
  tenantSettings,
} from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import { seedTenant } from "@/server/services/tenant-seed"
import {
  normalizeSeatEmail,
  provisionEntitySeats,
} from "@/lib/deployment-seats"
import { runAction, type ActionResult } from "@/lib/action-result"

const ALLOWED_INITIAL_ROLES = new Set([
  "Owner", "Admin", "Developer", "Manager", "Senior Rep", "Rep", "Viewer",
])

/**
 * Create a new entity (tenant/organization): provision the org via Better Auth
 * (the creator becomes Owner), seed its defaults (roles, permissions, funnel +
 * stages, tax, settings, entity code). The platform master remains outside
 * tenant membership; invited customer Owners claim access through the seat seam.
 */
export async function createEntity(input: {
  name: string
  slug?: string
  entityCode?: string
  invites: { email: string; roleName: string }[]
}): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
  const ctx = await getServerContext()
  if (!ctx) throw new Error("UNAUTHENTICATED")
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can create organizations.")
  const name = input.name.trim()
  if (!name) throw new Error("Entity name is required")
  const invites = input.invites.flatMap((invite) => {
    if (!invite.email.trim()) return []
    return [{ email: normalizeSeatEmail(invite.email), roleName: invite.roleName }]
  })
  if (new Set(invites.map((invite) => invite.email)).size !== invites.length) {
    throw new Error("Each invited email may only appear once.")
  }
  for (const invite of invites) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email)) throw new Error(`Invalid email: ${invite.email}`)
    if (invite.email === ctx.userEmail.toLowerCase()) {
      throw new Error("The platform master already has administrative access and does not need a customer seat.")
    }
    if (!ALLOWED_INITIAL_ROLES.has(invite.roleName)) throw new Error(`Invalid role for ${invite.email}.`)
  }

  const baseSlug = (input.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)
  const slug = baseSlug || `entity-${ctx.userId.slice(0, 6)}`
  const orgId = randomUUID()
  try {
    await db.insert(organization).values({ id: orgId, name, slug })
  } catch {
    await db.insert(organization).values({
      id: orgId,
      name,
      slug: `${slug}-${Date.now().toString(36)}`,
    })
  }

  await runInTenant(orgId, (tx) => seedTenant(tx, orgId, { entityCode: input.entityCode }))

  const roleRows = await runInTenant(orgId, (tx) => tx
    .select({ id: roles.id, name: roles.name, tier: roles.defaultTierLevel })
    .from(roles)
    .where(eq(roles.tenantId, orgId)))
  const roleByName = new Map(roleRows.map((role) => [role.name, role]))
  try {
    const entries: Parameters<typeof provisionEntitySeats>[0]["entries"] = []
    for (const invite of invites) {
      const role = roleByName.get(invite.roleName)
      if (!role) throw new Error(`Role ${invite.roleName} was not seeded.`)
      entries.push({ kind: "invite", email: invite.email, roleId: role.id, tierLevel: role.tier })
    }
    await provisionEntitySeats({
      tenantId: orgId,
      actor: { userId: ctx.userId },
      entries,
      entityAudit: { name, slug, invites: invites.map(({ email, roleName }) => ({ email, roleName })) },
    })
  } catch (error) {
    await db.delete(organization).where(eq(organization.id, orgId)).catch(() => undefined)
    throw error
  }

  return { id: orgId }
  })
}

// ─── Superadmin organization management ───────────────────────────────────────

export type OrgRow = {
  id: string
  name: string
  slug: string
  status: "active" | "archived"
  entityCode: string | null
  memberCount: number
  createdAt: Date | null
}

/** All organizations visible to the platform superadmin. */
export async function listAllOrganizations(): Promise<OrgRow[]> {
  const ctx = await getServerContext()
  if (!ctx) throw new Error("UNAUTHENTICATED")
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can list organizations.")

  const orgs = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      createdAt: organization.createdAt,
      entityCode: tenantSettings.entityCode,
    })
    .from(organization)
    .leftJoin(tenantSettings, eq(tenantSettings.organizationId, organization.id))
    .orderBy(organization.name)

  const memberCounts = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .groupBy(member.organizationId)

  const totalMemberCounts: Record<string, number> = {}
  for (const r of memberCounts) {
    totalMemberCounts[r.organizationId] = (totalMemberCounts[r.organizationId] ?? 0) + 1
  }

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: (o.status ?? "active") as "active" | "archived",
    entityCode: o.entityCode ?? null,
    memberCount: totalMemberCounts[o.id] ?? 0,
    createdAt: o.createdAt ?? null,
  }))
}

/** Update an organization's name, entity code, or suspension status. */
export async function updateOrganization(
  id: string,
  input: {
    name?: string | null
    entityCode?: string | null
    /** Suspend prevents all members from signing in. */
    suspended?: boolean
  }
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await getServerContext()
    if (!ctx) throw new Error("UNAUTHENTICATED")
    if (!ctx.isSuperadmin) throw new Error("Only the platform master can update organizations.")

    if (input.name !== undefined && input.name !== null && !input.name.trim()) {
      throw new Error("Organization name cannot be empty.")
    }
    const entityCode =
      input.entityCode !== undefined
        ? (input.entityCode?.trim().toUpperCase().slice(0, 16) || null)
        : undefined

    const [existing] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, id))
      .limit(1)
    if (!existing) throw new Error("Organization not found.")

    if (input.name !== undefined) {
      await db
        .update(organization)
        .set({ name: input.name!.trim() })
        .where(eq(organization.id, id))
    }

    // entityCode lives on tenant_settings
    if (entityCode !== undefined) {
      await db
        .insert(tenantSettings)
        .values({ organizationId: id, entityCode })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { entityCode },
        })
    }

    // suspended flag lives on tenant_settings.status
    if (input.suspended !== undefined) {
      const targetStatus = input.suspended ? "suspended" : "active"
      await db
        .insert(tenantSettings)
        .values({ organizationId: id, status: targetStatus })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { status: targetStatus },
        })
    }

    revalidatePath("/")
    return
  })
}

/** Archive (soft-delete) an organization. Archived orgs are hidden from normal
 * org pickers but retained for audit/history. */
export async function archiveOrganization(
  id: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await getServerContext()
    if (!ctx) throw new Error("UNAUTHENTICATED")
    if (!ctx.isSuperadmin) throw new Error("Only the platform master can archive organizations.")

    const [existing] = await db
      .select({ id: organization.id, status: organization.status })
      .from(organization)
      .where(eq(organization.id, id))
      .limit(1)
    if (!existing) throw new Error("Organization not found.")
    if (existing.status === "archived") {
      throw new Error("This organization is already archived.")
    }

    await db
      .update(organization)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(organization.id, id))

    revalidatePath("/")
    return
  })
}

