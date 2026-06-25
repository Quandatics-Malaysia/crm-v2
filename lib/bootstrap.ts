import "server-only"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import { member, organization, membershipProfiles, roles } from "@/db/schema"

/**
 * First-login provisioning. If the seeded default entity has no members yet, or
 * the signed-in email matches BOOTSTRAP_OWNER_EMAIL, attach this user as Owner.
 * Lets the very first Microsoft sign-in claim ownership without manual SQL.
 */
export async function ensureBootstrap(
  userId: string,
  userEmail: string
): Promise<boolean> {
  const [org] = await db.select().from(organization).limit(1)
  if (!org) return false

  // already a member of this org?
  const mine = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, org.id)))
    .limit(1)
  if (mine.length) return false

  const bootstrapEmail = process.env.BOOTSTRAP_OWNER_EMAIL?.toLowerCase()
  const existingMembers = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, org.id))
    .limit(1)

  const allowed =
    existingMembers.length === 0 ||
    (!!bootstrapEmail && bootstrapEmail === userEmail.toLowerCase())
  if (!allowed) return false

  const memberId = randomUUID()
  await db.insert(member).values({
    id: memberId,
    organizationId: org.id,
    userId,
    role: "owner",
    createdAt: new Date(),
  })

  const [ownerRole] = await runInTenant(org.id, (tx) =>
    tx.select({ id: roles.id }).from(roles).where(eq(roles.name, "Owner")).limit(1)
  )

  await runInTenant(org.id, (tx) =>
    tx.insert(membershipProfiles).values({
      memberId,
      tenantId: org.id,
      roleId: ownerRole?.id ?? null,
      tierLevel: 100,
      status: "active",
    })
  )

  return true
}
