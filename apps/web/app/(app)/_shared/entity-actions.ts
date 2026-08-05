"use server"

import { headers } from "next/headers"
import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, runInTenant } from "@/db"
import {
  member,
  membershipProfiles,
  memberRoles,
  pendingInvites,
  roles,
  tenantSettings,
  user,
} from "@/db/schema"
import { getServerContext } from "@/lib/server-context"
import { seedTenant } from "@/server/services/tenant-seed"
import { writeAuthAudit } from "@/server/audit"

const ALLOWED_INITIAL_ROLES = new Set([
  "Owner", "Admin", "Developer", "Manager", "Senior Rep", "Rep", "Viewer",
])

function parseDate(value: string, field: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be a valid date.`)
  const date = new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`)
  return date
}

/**
 * Create a new entity (tenant/organization): provision the org via Better Auth
 * (the creator becomes Owner), seed its defaults (roles, permissions, funnel +
 * stages, tax, settings, entity code), and switch to it.
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
  const plan = input.plan.trim()
  if (!plan) throw new Error("Plan name is required")
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 10000) {
    throw new Error("Seats must be a whole number between 1 and 10,000.")
  }
  const startsAt = parseDate(input.startsAt, "Valid from")
  const endsAt = parseDate(input.endsAt, "Valid until", true)
  if (startsAt > endsAt) throw new Error("Valid from must be before valid until.")
  const invites = input.invites
    .map((invite) => ({ email: invite.email.trim().toLowerCase(), roleName: invite.roleName }))
    .filter((invite) => invite.email)
  if (new Set(invites.map((invite) => invite.email)).size !== invites.length) {
    throw new Error("Each invited email may only appear once.")
  }
  if (invites.length > input.seats) throw new Error("Invited users cannot exceed issued seats.")
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
        .update(tenantSettings)
        .set({
          subscriptionPlan: plan,
          subscriptionStatus: "active",
          subscriptionSeatLimit: input.seats,
          subscriptionStartsAt: startsAt,
          subscriptionEndsAt: endsAt,
          updatedAt: new Date(),
        })
        .where(eq(tenantSettings.organizationId, orgId))
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
      const roleRows = await tx
        .select({ id: roles.id, name: roles.name, tier: roles.defaultTierLevel })
        .from(roles)
        .where(eq(roles.tenantId, orgId))
      const roleByName = new Map(roleRows.map((role) => [role.name, role]))

      for (const invite of invites) {
        const role = roleByName.get(invite.roleName)
        if (!role) throw new Error(`Role ${invite.roleName} was not seeded.`)
        const [existingUser] = await tx
          .select({ id: user.id })
          .from(user)
          .where(sql`lower(${user.email}) = ${invite.email}`)
          .limit(1)
        if (!existingUser) {
          await tx.insert(pendingInvites).values({
            tenantId: orgId,
            email: invite.email,
            roleId: role.id,
            tierLevel: role.tier,
            invitedByMemberId: m.id,
          })
          continue
        }
        const invitedMemberId = randomUUID()
        await tx.insert(member).values({
          id: invitedMemberId,
          organizationId: orgId,
          userId: existingUser.id,
          role: "member",
        })
        await tx.insert(membershipProfiles).values({
          memberId: invitedMemberId,
          tenantId: orgId,
          roleId: role.id,
          tierLevel: role.tier,
          status: "active",
        })
        await tx.insert(memberRoles).values({
          tenantId: orgId,
          memberId: invitedMemberId,
          roleId: role.id,
        })
      }

      await writeAuthAudit(tx, {
        tenantId: orgId,
        action: "entity.created",
        actorUserId: ctx.userId,
        actorMemberId: m.id,
        entityType: "organization",
        entityId: orgId,
        after: {
          name,
          slug,
          plan,
          seats: input.seats,
          startsAt,
          endsAt,
          invites: invites.map(({ email, roleName }) => ({ email, roleName })),
        },
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
