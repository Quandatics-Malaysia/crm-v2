"use server"

import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import {
  organization,
  roles,
  user,
} from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import { seedTenant } from "@/server/services/tenant-seed"
import {
  normalizeSeatEmail,
  provisionEntitySeats,
} from "@/lib/deployment-seats"

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
  plan: string
  seats: number
  startsAt: string
  endsAt: string
  invites: { email: string; roleName: string }[]
}): Promise<{ id: string }> {
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
      const [existingUser] = await db.select({ id: user.id }).from(user)
        .where(sql`lower(btrim(${user.email})) = ${invite.email}`).limit(1)
      if (existingUser) {
        entries.push({ kind: "active", userId: existingUser.id, roleId: role.id, tierLevel: role.tier })
      } else {
        entries.push({ kind: "invite", email: invite.email, roleId: role.id, tierLevel: role.tier })
      }
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
}
