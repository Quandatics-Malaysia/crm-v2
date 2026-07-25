"use server"

import { headers } from "next/headers"
import { and, eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, runInTenant } from "@/db"
import { member, membershipProfiles, memberRoles } from "@/db/schema"
import { requireContext } from "@/lib/server-context"
import { seedTenant } from "@/server/services/tenant-seed"
import { writeAuthAudit } from "@/server/audit"

/**
 * Cap on how many entities (organizations) a single user may belong to, to keep
 * self-service entity creation from being abused into unbounded tenant spam.
 */
const MAX_ENTITIES_PER_USER = 10

/**
 * Create a new entity (tenant/organization): provision the org via Better Auth
 * (the creator becomes Owner), seed its defaults (roles, permissions, funnel +
 * stages, tax, settings, entity code), and switch to it.
 */
export async function createEntity(input: {
  name: string
  slug?: string
  entityCode?: string
}): Promise<{ id: string }> {
  // requireContext now rejects non-active memberships, so a disabled member
  // can't spin up new tenants.
  const ctx = await requireContext()
  const name = input.name.trim()
  if (!name) throw new Error("Entity name is required")

  // Per-user org cap: count the memberships this user already holds.
  const [{ count: orgCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.userId, ctx.userId))
  if (Number(orgCount) >= MAX_ENTITIES_PER_USER) {
    throw new Error(
      `You've reached the limit of ${MAX_ENTITIES_PER_USER} entities per user.`
    )
  }

  const baseSlug = (input.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40)
  const slug = baseSlug || `entity-${ctx.userId.slice(0, 6)}`
  const hdrs = await headers()

  let org: { id?: string } | null = null
  try {
    org = (await auth.api.createOrganization({
      body: { name, slug },
      headers: hdrs,
    })) as { id?: string } | null
  } catch {
    org = (await auth.api.createOrganization({
      body: { name, slug: `${slug}-${Date.now().toString(36)}` },
      headers: hdrs,
    })) as { id?: string } | null
  }
  const orgId = org?.id
  if (!orgId) throw new Error("Could not create the entity")

  const ownerRoleId = await runInTenant(orgId, (tx) =>
    seedTenant(tx, orgId, { entityCode: input.entityCode })
  )

  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ctx.userId), eq(member.organizationId, orgId)))
    .limit(1)
  if (m) {
    await runInTenant(orgId, async (tx) => {
      await tx
        .insert(membershipProfiles)
        .values({
          memberId: m.id,
          tenantId: orgId,
          roleId: ownerRoleId,
          tierLevel: 100,
          status: "active",
        })
        .onConflictDoNothing()
      // member_roles = effective-permission source (union of assigned roles).
      if (ownerRoleId) {
        await tx
          .insert(memberRoles)
          .values({ tenantId: orgId, memberId: m.id, roleId: ownerRoleId })
          .onConflictDoNothing()
      }
      // Audit the entity's creation, scoped to the new org (RLS-safe here since
      // runInTenant sets app.current_tenant = orgId).
      await writeAuthAudit(tx, {
        tenantId: orgId,
        action: "entity.created",
        actorUserId: ctx.userId,
        actorMemberId: m.id,
        entityType: "organization",
        entityId: orgId,
        after: { name, slug },
      })
    })
  }

  try {
    await auth.api.setActiveOrganization({
      body: { organizationId: orgId },
      headers: hdrs,
    })
  } catch {
    // non-fatal; the switcher can set it later
  }

  return { id: orgId }
}
