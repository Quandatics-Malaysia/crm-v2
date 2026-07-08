import "server-only"
import { randomUUID } from "node:crypto"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  member,
  organization,
  membershipProfiles,
  memberRoles,
  roles,
} from "@/db/schema"

/**
 * First-login provisioning. If the (deterministically selected) default entity
 * has no members yet, or the signed-in email matches BOOTSTRAP_OWNER_EMAIL,
 * attach this user as Owner. Lets the very first Microsoft sign-in claim
 * ownership without manual SQL.
 *
 * The whole check-then-insert runs in ONE transaction with the org's member
 * rows locked (`FOR UPDATE`), so two concurrent first-logins can't both claim
 * ownership of a zero-member org.
 */
export async function ensureBootstrap(
  userId: string,
  userEmail: string
): Promise<boolean> {
  const bootstrapEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.toLowerCase()

  return db.transaction(async (tx) => {
    // Deterministic org selection — oldest org first (stable across deploys),
    // not an arbitrary `.limit(1)`.
    const [org] = await tx
      .select()
      .from(organization)
      .orderBy(asc(organization.createdAt), asc(organization.id))
      .limit(1)
    if (!org) return false

    // Lock this org's member rows for the duration of the tx so the
    // count + claim decision can't race another concurrent first-login.
    const existing = await tx
      .select({ id: member.id, userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, org.id))
      .for("update")

    // Already a member of this org?
    if (existing.some((m) => m.userId === userId)) return false

    const allowed =
      existing.length === 0 ||
      (!!bootstrapEmail && bootstrapEmail === userEmail.toLowerCase())
    if (!allowed) return false

    const memberId = randomUUID()
    await tx.insert(member).values({
      id: memberId,
      organizationId: org.id,
      userId,
      role: "owner",
      createdAt: new Date(),
    })

    // membership_profiles + roles are RLS-scoped: set the tenant GUC for the
    // rest of this transaction so the inserts/reads pass the policies.
    await tx.execute(
      sql`select set_config('app.current_tenant', ${org.id}, true)`
    )

    const [ownerRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, "Owner"), eq(roles.tenantId, org.id)))
      .limit(1)

    await tx.insert(membershipProfiles).values({
      memberId,
      tenantId: org.id,
      roleId: ownerRole?.id ?? null,
      tierLevel: 100,
      status: "active",
    })
    // member_roles = effective-permission source (union of assigned roles).
    if (ownerRole?.id) {
      await tx.insert(memberRoles).values({
        tenantId: org.id,
        memberId,
        roleId: ownerRole.id,
      })
    }

    return true
  })
}
