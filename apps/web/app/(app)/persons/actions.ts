"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull, ne } from "drizzle-orm"
import { withTenant, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { personsList, personsGet } from "@/lib/api-readers"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { recordChanges } from "@/server/services/changes/record"
import { runAction, type ActionResult } from "@/lib/action-result"
import { accounts, persons } from "@/db/schema"
import {
  normalizeEmailInput,
  normalizePhoneInput,
  normalizeTextInput,
} from "@/lib/input-validation"

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
  funnels: PersonOpportunity[]
  projects: PersonProject[]
}

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

function normalizePersonInput(input: PersonInput): PersonInput {
  const firstName = normalizeTextInput(input.firstName, "First name", 120)
  const lastName = normalizeTextInput(input.lastName, "Last name", 120)
  const title = normalizeTextInput(input.title, "Title", 160)
  const department = normalizeTextInput(input.department, "Department", 160)
  const email = normalizeEmailInput(input.email, "Email")
  const phone = normalizePhoneInput(input.phone, "Phone")
  if (!firstName) throw new Error("First name is required.")
  return {
    ...input,
    firstName,
    lastName,
    title,
    department,
    email,
    phone,
  }
}

export type PersonInput = {
  accountId: string
  firstName: string
  lastName?: string | null
  title?: string | null
  department?: string | null
  email?: string | null
  phone?: string | null
  isPrimary?: boolean
}

/** All non-deleted persons with their account name resolved. */
export async function listPersons(): Promise<PersonListItem[]> {
  return withTenant(PERMISSIONS.PERSON_VIEW, async (tx, ctx) => {
    const { rows } = await personsList(tx, ctx, { limit: LIST_LIMIT, offset: 0 })
    return rows
  })
}

/**
 * One contact with its account name and the funnels where this person
 * is the primary contact (each with its current stage for a badge + link).
 */
export async function getPerson(id: string): Promise<PersonDetail | null> {
  return withTenant(PERMISSIONS.PERSON_VIEW, (tx, ctx) => personsGet(tx, ctx, id))
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

    const normalized = normalizePersonInput(input)

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
          firstName: normalized.firstName,
          lastName: normalized.lastName || null,
          title: normalized.title || null,
          department: normalized.department || null,
          email: normalized.email || null,
          phone: normalized.phone || null,
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

    const normalized = normalizePersonInput(input)

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

      const updated = {
        accountId: input.accountId,
        firstName: normalized.firstName,
        lastName: normalized.lastName || null,
        title: normalized.title || null,
        department: normalized.department || null,
        email: normalized.email || null,
        phone: normalized.phone || null,
        isPrimary: input.isPrimary ?? false,
        updatedAt: new Date(),
      }

      await tx.update(persons).set(updated).where(eq(persons.id, id))

      await recordChanges(tx, ctx, {
        entityType: "person",
        registryKey: "person",
        entityId: id,
        before,
        after: { ...before, ...updated },
        subject: "Contact updated",
      })
      return { ...before, ...updated }
    })
    revalidatePath("/persons")
    revalidatePath(`/persons/${id}`)
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
