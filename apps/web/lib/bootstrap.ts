import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import {
  organization,
  roles,
} from "@/db/schema"
import { bootstrapOwner } from "@/lib/deployment-seats"

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
  const configuredEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()
  const normalizedUserEmail = userEmail.trim().toLowerCase()
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
    const activation = await bootstrapOwner({
      tenantId: org.id,
      roleId: ownerRole?.id ?? null,
      tierLevel: 100,
      userId,
      mode: configuredEmail && normalizedUserEmail === configuredEmail ? "configured" : "empty",
    })
    return activation.result.reason !== "idempotent"
  } catch (error) {
    if (error instanceof Error && /already claimed|Already a member/.test(error.message)) {
      return false
    }
    throw error
  }
}
