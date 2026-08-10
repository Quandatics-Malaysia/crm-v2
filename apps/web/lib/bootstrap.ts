import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import {
  member,
  organization,
  roles,
} from "@/db/schema"
import { activateMembership } from "@/lib/deployment-seats"

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

  const [org] = await db
      .select()
      .from(organization)
      .orderBy(asc(organization.createdAt), asc(organization.id))
      .limit(1)
  if (!org) return false
  const [ownerRole] = await runInTenant(org.id, (tx) => tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, "Owner"), eq(roles.tenantId, org.id)))
      .limit(1)
  )
  if (!ownerRole) return false

  try {
    await activateMembership({
      tenantId: org.id,
      roleId: ownerRole?.id ?? null,
      tierLevel: 100,
      userId,
      actor: { userId },
      guard: async (tx) => {
        const existing = await tx
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, org.id))
          .for("update")
        if (existing.some((row) => row.userId === userId)) throw new Error("ALREADY_BOOTSTRAPPED")
        if (existing.length > 0 && bootstrapEmail !== userEmail.toLowerCase()) {
          throw new Error("BOOTSTRAP_NOT_ALLOWED")
        }
      },
    })
    return true
  } catch (error) {
    if (error instanceof Error && ["ALREADY_BOOTSTRAPPED", "BOOTSTRAP_NOT_ALLOWED"].includes(error.message)) {
      return false
    }
    throw error
  }
}
