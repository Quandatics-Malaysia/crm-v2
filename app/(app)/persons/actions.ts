"use server"

import { revalidatePath } from "next/cache"
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm"
import { withTenant, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { runAction, type ActionResult } from "@/lib/action-result"
import {
  accounts,
  persons,
  opportunities,
  funnelStages,
  projects,
} from "@/db/schema"

/** Largest page we ever return from a list endpoint (defense against unbounded scans). */
const LIST_LIMIT = 1000

export type PersonRow = typeof persons.$inferSelect

export type PersonListItem = PersonRow & { accountName: string | null }

export type PersonOpportunity = {
  id: string
  name: string
  amount: string | null
  currency: string
  status: string
  stageName: string | null
  stageKind: string | null
  stageProbability: string | null
}

export type PersonProject = {
  id: string
  name: string
  projectCode: string | null
  status: string
}

export type PersonDetail = {
  person: PersonRow
  accountName: string | null
  opportunities: PersonOpportunity[]
  projects: PersonProject[]
}

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

export type PersonInput = {
  accountId: string
  firstName: string
  lastName?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
  isPrimary?: boolean
}

/** All non-deleted persons with their account name resolved. */
export async function listPersons(): Promise<PersonListItem[]> {
  return withTenant(PERMISSIONS.PERSON_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        person: persons,
        accountName: accounts.name,
      })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(
        and(
          isNull(persons.deletedAt),
          isNull(accounts.deletedAt),
          ownerScope(accounts.ownerMemberId, visible)
        )
      )
      .orderBy(asc(persons.firstName), asc(persons.lastName))
      .limit(LIST_LIMIT)

    return rows.map((r) => ({ ...r.person, accountName: r.accountName }))
  })
}

/**
 * One contact with its account name and the opportunities where this person
 * is the primary contact (each with its current stage for a badge + link).
 */
export async function getPerson(id: string): Promise<PersonDetail | null> {
  return withTenant(PERMISSIONS.PERSON_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [row] = await tx
      .select({
        person: persons,
        accountName: accounts.name,
        accountOwner: accounts.ownerMemberId,
      })
      .from(persons)
      .innerJoin(accounts, eq(persons.accountId, accounts.id))
      .where(
        and(
          eq(persons.id, id),
          isNull(persons.deletedAt),
          isNull(accounts.deletedAt)
        )
      )
      .limit(1)
    if (!row) return null
    if (!ownsOrManages(visible, row.accountOwner)) return null

    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        amount: opportunities.estimatedAmount,
        currency: opportunities.currency,
        status: opportunities.status,
        stageName: funnelStages.name,
        stageKind: funnelStages.kind,
        stageProbability: funnelStages.probability,
      })
      .from(opportunities)
      .leftJoin(
        funnelStages,
        eq(opportunities.currentStageId, funnelStages.id)
      )
      .where(
        and(
          eq(opportunities.primaryPersonId, id),
          isNull(opportunities.deletedAt)
        )
      )
      .orderBy(desc(opportunities.updatedAt))

    // Projects that belong to this contact's funnels (the deals they're on).
    const oppIds = opps.map((o) => o.id)
    const projs = oppIds.length
      ? await tx
          .select({
            id: projects.id,
            name: projects.name,
            projectCode: projects.projectCode,
            status: projects.status,
          })
          .from(projects)
          .where(
            and(
              inArray(projects.opportunityId, oppIds),
              isNull(projects.deletedAt)
            )
          )
          .orderBy(desc(projects.updatedAt))
      : []

    return {
      person: row.person,
      accountName: row.accountName,
      opportunities: opps,
      projects: projs,
    }
  })
}

/** Clears the primary flag on any other contact of the same account. */
async function clearOtherPrimaries(
  tx: Tx,
  accountId: string,
  exceptPersonId?: string
) {
  await tx
    .update(persons)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(persons.accountId, accountId),
        eq(persons.isPrimary, true),
        isNull(persons.deletedAt),
        exceptPersonId ? ne(persons.id, exceptPersonId) : undefined
      )
    )
}

export async function createPerson(
  input: PersonInput
): Promise<ActionResult<PersonRow>> {
  return runAction(async () => {
    if (!input.accountId) throw new Error("A contact must belong to an account.")

    const row = await withTenant(PERMISSIONS.PERSON_CREATE, async (tx, ctx) => {
      const visible = await visibleMemberIds(tx, ctx)
      const [account] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
        .limit(1)
      if (!account) throw new Error("Account not found")
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, account.ownerMemberId)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      if (input.isPrimary) await clearOtherPrimaries(tx, input.accountId)

      const [created] = await tx
        .insert(persons)
        .values({
          tenantId: ctx.tenantId,
          accountId: input.accountId,
          firstName: input.firstName,
          lastName: input.lastName || null,
          title: input.title || null,
          email: input.email || null,
          phone: input.phone || null,
          isPrimary: input.isPrimary ?? false,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "person.create",
        entityType: "person",
        entityId: created.id,
        after: created,
      })
      await logActivity(tx, ctx, {
        entityType: "person",
        entityId: created.id,
        type: "system",
        subject: `Created contact ${fullName(created)}`,
      })
      return created
    })
    revalidatePath("/persons")
    revalidatePath(`/accounts/${input.accountId}`)
    return row
  })
}

export async function updatePerson(
  id: string,
  input: PersonInput
): Promise<ActionResult<PersonRow>> {
  return runAction(async () => {
    if (!input.accountId) throw new Error("A contact must belong to an account.")

    const row = await withTenant(PERMISSIONS.PERSON_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(persons)
        .where(and(eq(persons.id, id), isNull(persons.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Contact not found.")

      const visible = await visibleMemberIds(tx, ctx)
      const [account] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(eq(accounts.id, before.accountId))
        .limit(1)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, account?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      // Reassigning to a different account: validate the destination exists in
      // this tenant and the caller owns/manages it (mirrors createPerson) —
      // closes the cross-tenant FK / record-scope bypass on the destination.
      if (input.accountId !== before.accountId) {
        const [dest] = await tx
          .select({ ownerMemberId: accounts.ownerMemberId })
          .from(accounts)
          .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
          .limit(1)
        if (!dest) throw new Error("Account not found")
        if (
          !canManageAllRecords(ctx) &&
          !ownsOrManages(visible, dest.ownerMemberId)
        ) {
          throw new Error("FORBIDDEN: not permitted on this account")
        }
      }

      if (input.isPrimary) await clearOtherPrimaries(tx, input.accountId, id)

      const [updated] = await tx
        .update(persons)
        .set({
          accountId: input.accountId,
          firstName: input.firstName,
          lastName: input.lastName || null,
          title: input.title || null,
          email: input.email || null,
          phone: input.phone || null,
          isPrimary: input.isPrimary ?? false,
          updatedAt: new Date(),
        })
        .where(eq(persons.id, id))
        .returning()
      await writeAudit(tx, ctx, {
        action: "person.update",
        entityType: "person",
        entityId: id,
        before,
        after: updated,
      })
      await logActivity(tx, ctx, {
        entityType: "person",
        entityId: id,
        type: "system",
        subject: "Updated contact",
      })
      return updated
    })
    revalidatePath("/persons")
    revalidatePath(`/accounts/${input.accountId}`)
    return row
  })
}

export async function deletePerson(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PERSON_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(persons)
        .where(and(eq(persons.id, id), isNull(persons.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Contact not found.")

      const visible = await visibleMemberIds(tx, ctx)
      const [account] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(eq(accounts.id, before.accountId))
        .limit(1)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, account?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      await tx
        .update(persons)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(persons.id, id))
      await writeAudit(tx, ctx, {
        action: "person.delete",
        entityType: "person",
        entityId: id,
        before,
      })
      revalidatePath(`/accounts/${before.accountId}`)
    })
    revalidatePath("/persons")
  })
}

/** Reverse a soft delete (undo). Clears deletedAt for a contact the caller owns/manages. */
export async function restorePerson(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PERSON_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(persons)
        .where(eq(persons.id, id))
        .limit(1)
      if (!before) throw new Error("Contact not found.")
      if (!before.deletedAt) return // already active

      const visible = await visibleMemberIds(tx, ctx)
      const [account] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(eq(accounts.id, before.accountId))
        .limit(1)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, account?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      await tx
        .update(persons)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(persons.id, id))
      await writeAudit(tx, ctx, {
        action: "person.restore",
        entityType: "person",
        entityId: id,
        after: before,
      })
      revalidatePath(`/accounts/${before.accountId}`)
    })
    revalidatePath("/persons")
  })
}

/** Makes the given contact the primary one for its account. */
export async function setPrimaryPerson(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PERSON_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(persons)
        .where(and(eq(persons.id, id), isNull(persons.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Contact not found.")

      const visible = await visibleMemberIds(tx, ctx)
      const [account] = await tx
        .select({ ownerMemberId: accounts.ownerMemberId })
        .from(accounts)
        .where(eq(accounts.id, before.accountId))
        .limit(1)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, account?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      await clearOtherPrimaries(tx, before.accountId, id)
      await tx
        .update(persons)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(persons.id, id))
      await writeAudit(tx, ctx, {
        action: "person.set_primary",
        entityType: "person",
        entityId: id,
        before,
      })
      revalidatePath(`/accounts/${before.accountId}`)
    })
    revalidatePath("/persons")
  })
}
