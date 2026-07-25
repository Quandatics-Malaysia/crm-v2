"use server"

import { revalidatePath } from "next/cache"
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { writeAudit } from "@/server/audit"
import { logActivity } from "@/server/services/activity"
import { recordChanges } from "@/server/services/changes/record"
import { cascadeAccountOwner } from "@/server/services/owner-cascade"
import { runAction, type ActionResult } from "@/lib/action-result"
import type { Tx, ServerContext } from "@/lib/actions"
import {
  accounts,
  persons,
  funnels,
  opportunities,
  pipelineStages,
  projects,
  quotations,
  member,
  user,
} from "@/db/schema"

/** Largest page we ever return from a list endpoint (defense against unbounded scans). */
const LIST_LIMIT = 1000

export type AccountRow = typeof accounts.$inferSelect
export type PersonRow = typeof persons.$inferSelect

export type AccountListItem = AccountRow & {
  parentAccountName: string | null
  ownerName: string | null
}

/** Structured billing address persisted into the billingAddress jsonb column. */
export type BillingAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
}

/** One opportunity related to an account, with its current stage resolved. */
export type AccountFunnelItem = {
  funnelId: string
  name: string
  status: string
  amount: string | null
  currency: string
  pipelineId: string
  stageId: string
  stageName: string
  stageCode: string
  stageKind: string
}

export type AccountInput = {
  name: string
  code?: string | null
  parentAccountId?: string | null
  /** "client" (end user) or "reseller" (channel); defaults to "client". */
  accountType?: string | null
  /** Required for resellers: the end-user client account. */
  endUserAccountId?: string | null
  /**
   * Account owner / account manager (Salesforce "Account Owner"). When changed
   * on update, the new owner cascades to the account's child persons,
   * opportunities, and funnels. Omit to leave the current owner unchanged.
   */
  ownerMemberId?: string | null
  industry?: string | null
  website?: string | null
  /** Main office / switchboard phone. */
  phone?: string | null
  registrationNumber?: string | null
  billingAddress?: BillingAddress | null
}

/**
 * Resolve accountType + endUserAccountId for persistence. A reseller must name
 * an end-user account; a client is its own end user, so its endUserAccountId is
 * always cleared. Defaults to "client".
 */
function resolveAccountType(input: AccountInput): {
  accountType: "client" | "reseller"
  endUserAccountId: string | null
} {
  const accountType = input.accountType === "reseller" ? "reseller" : "client"
  if (accountType === "reseller") {
    if (!input.endUserAccountId) {
      throw new Error("End user is required for resellers")
    }
    return { accountType, endUserAccountId: input.endUserAccountId }
  }
  return { accountType, endUserAccountId: null }
}

/**
 * All non-deleted accounts with their parent account name and owner (account
 * manager) name resolved — the owner name backs the Owner facet on the list.
 */
export async function listAccounts(): Promise<AccountListItem[]> {
  return withTenant(PERMISSIONS.ACCOUNT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({ account: accounts, ownerName: user.name })
      .from(accounts)
      .leftJoin(member, eq(accounts.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(
        and(isNull(accounts.deletedAt), ownerScope(accounts.ownerMemberId, visible))
      )
      .orderBy(asc(accounts.name))
      .limit(LIST_LIMIT)

    const byId = new Map(rows.map((r) => [r.account.id, r.account]))
    return rows.map((r) => ({
      ...r.account,
      parentAccountName: r.account.parentAccountId
        ? (byId.get(r.account.parentAccountId)?.name ?? null)
        : null,
      ownerName: r.ownerName ?? null,
    }))
  })
}

/**
 * A single account with its persons, direct child accounts, and related
 * pipelines (funnels for this account + their current stage so each row
 * can link to /funnel/<oppId>).
 */
export async function getAccount(id: string) {
  return withTenant(PERMISSIONS.ACCOUNT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1)
    if (!account) return null
    if (!ownsOrManages(visible, account.ownerMemberId)) return null

    const parent = account.parentAccountId
      ? (
          await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.id, account.parentAccountId),
                isNull(accounts.deletedAt)
              )
            )
            .limit(1)
        )[0] ?? null
      : null

    // For resellers, resolve the linked end-user client account (name + id).
    const endUserAccount = account.endUserAccountId
      ? (
          await tx
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(
              and(
                eq(accounts.id, account.endUserAccountId),
                isNull(accounts.deletedAt)
              )
            )
            .limit(1)
        )[0] ?? null
      : null

    const children = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.parentAccountId, id),
          isNull(accounts.deletedAt),
          ownerScope(accounts.ownerMemberId, visible)
        )
      )
      .orderBy(asc(accounts.name))

    const contacts = await tx
      .select()
      .from(persons)
      .where(and(eq(persons.accountId, id), isNull(persons.deletedAt)))
      .orderBy(asc(persons.firstName))

    const pipelines = await tx
      .select({
        funnelId: funnels.id,
        name: funnels.name,
        status: funnels.status,
        amount: funnels.estimatedAmount,
        currency: funnels.currency,
        pipelineId: funnels.pipelineId,
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        stageCode: pipelineStages.code,
        stageKind: pipelineStages.kind,
      })
      .from(funnels)
      .innerJoin(
        pipelineStages,
        eq(funnels.currentStageId, pipelineStages.id)
      )
      .where(
        and(
          eq(funnels.accountId, id),
          isNull(funnels.deletedAt),
          ownerScope(funnels.ownerMemberId, visible)
        )
      )
      .orderBy(asc(pipelineStages.sortOrder), asc(funnels.name))

    // Resolve the account owner / account manager (member -> user name).
    const ownerName = account.ownerMemberId
      ? (
          await tx
            .select({ name: user.name })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(eq(member.id, account.ownerMemberId))
            .limit(1)
        )[0]?.name ?? null
      : null

    return {
      account,
      parent,
      endUserAccount,
      children,
      contacts,
      pipelines: pipelines as AccountFunnelItem[],
      ownerName,
    }
  })
}

/** One delivery project belonging to an account. */
export type AccountProjectItem = {
  id: string
  projectCode: string
  name: string
  status: typeof projects.$inferSelect.status
}

/** Non-deleted projects for an account, newest first, for the account page. */
export type AccountOpportunityItem = {
  id: string
  code: string
  name: string
  totalEstimatedFunnelAmount: string | null
  currency: string
  funnelCount: number
}

/** Opportunity containers for an account, with their funnel counts. */
export async function listAccountOpportunities(
  accountId: string
): Promise<AccountOpportunityItem[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: opportunities.id,
        code: opportunities.code,
        name: opportunities.name,
        totalEstimatedFunnelAmount: opportunities.totalEstimatedFunnelAmount,
        currency: opportunities.currency,
        funnelCount: sql<number>`(select count(*)::int from ${funnels} f where f.opportunity_id = ${opportunities.id} and f.deleted_at is null)`,
      })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.accountId, accountId),
          isNull(opportunities.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(desc(opportunities.createdAt))
  })
}

export async function listAccountProjects(
  accountId: string
): Promise<AccountProjectItem[]> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: projects.id,
        projectCode: projects.projectCode,
        name: projects.name,
        status: projects.status,
      })
      .from(projects)
      .where(
        and(
          eq(projects.accountId, accountId),
          isNull(projects.deletedAt),
          ownerScope(projects.ownerMemberId, visible)
        )
      )
      .orderBy(desc(projects.createdAt))
  })
}

/** One quotation across an account's funnels. */
export type AccountQuotationItem = {
  id: string
  quoteNumber: string
  status: typeof quotations.$inferSelect.status
  total: string
  currency: string
}

/**
 * Quotations for every opportunity under an account (quotations -> funnels
 * where funnels.accountId = accountId), newest first, for the account page.
 */
export async function listAccountQuotations(
  accountId: string
): Promise<AccountQuotationItem[]> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: quotations.id,
        quoteNumber: quotations.quoteNumber,
        status: quotations.status,
        total: quotations.total,
        currency: quotations.currency,
      })
      .from(quotations)
      .innerJoin(funnels, eq(quotations.funnelId, funnels.id))
      .where(
        and(
          eq(funnels.accountId, accountId),
          isNull(quotations.deletedAt),
          isNull(funnels.deletedAt),
          ownerScope(funnels.ownerMemberId, visible)
        )
      )
      .orderBy(desc(quotations.createdAt))
  })
}

function cleanAddress(a?: BillingAddress | null): BillingAddress | null {
  if (!a) return null
  const entries = Object.entries(a).filter(([, v]) => v != null && v !== "")
  return entries.length ? Object.fromEntries(entries) : null
}

/**
 * Normalize an account code: trim + uppercase, treating empty/whitespace as
 * null (the code is optional). When provided it must be 2–6 letters/digits.
 */
function normalizeCode(code?: string | null): string | null {
  const trimmed = (code ?? "").trim().toUpperCase()
  if (!trimmed) return null
  if (!/^[A-Z0-9]{2,6}$/.test(trimmed)) {
    throw new Error("Account code must be 2–6 characters")
  }
  return trimmed
}

/**
 * Derive a short (3–5 char) upper-case alphanumeric base code from an account
 * name. Falls back to "ACC" when the name has no usable characters. Mirrors
 * db/backfill-project-codes.ts so manually-created and backfilled accounts get
 * codes from the same algorithm.
 */
function baseCodeFromName(name: string): string {
  const cleaned = (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return "ACC"
  // Single word → first 3–5 chars. Multiple words → first word padded with the
  // leading chars of following words until we reach ~5, keeping it readable.
  let base = words[0].slice(0, 5)
  for (let i = 1; i < words.length && base.length < 3; i++) {
    base += words[i].slice(0, 3 - base.length)
  }
  base = base.slice(0, 5)
  if (base.length < 3) base = (base + "ACC").slice(0, 3)
  return base
}

/** Make `base` unique within `used` (per-tenant) by appending 2, 3, … */
function uniqueCode(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * Auto-generate a tenant-unique account code from the name, used when the user
 * leaves the code blank. Seeds the "used" set from the tenant's existing
 * non-deleted codes (case-insensitive) so the result never collides — matching
 * the uniqueness guarantee assertCodeUnique enforces on user-entered codes.
 */
async function generateAccountCode(
  tx: Tx,
  tenantId: string,
  name: string
): Promise<string> {
  const rows = await tx
    .select({ code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)))
  const used = new Set<string>()
  for (const r of rows) {
    if (r.code && r.code.trim()) used.add(r.code.trim().toUpperCase())
  }
  return uniqueCode(baseCodeFromName(name), used)
}

/**
 * Ensure no other non-deleted account in this tenant already uses the given
 * (normalized) code, case-insensitively. On update pass selfId to exclude the
 * account being edited.
 */
async function assertCodeUnique(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  code: string,
  selfId?: string
): Promise<void> {
  const [existing] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.tenantId, tenantId),
        eq(sql`upper(${accounts.code})`, code),
        isNull(accounts.deletedAt),
        selfId ? ne(accounts.id, selfId) : undefined
      )
    )
    .limit(1)
  if (existing) {
    throw new Error("Account code already used by another customer")
  }
}

/**
 * Validate a prospective parent: it must exist (non-deleted) in this tenant, and
 * walking its ancestor chain must never reach `selfId` — otherwise assigning it
 * would create a multi-level cycle (A→B→A). `selfId` is omitted on create
 * (a brand-new account can't yet be anyone's ancestor).
 */
async function assertParentValid(
  tx: Tx,
  parentId: string,
  selfId?: string
): Promise<void> {
  const seen = new Set<string>(selfId ? [selfId] : [])
  let cursor: string | null = parentId
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error("This parent would create a circular account hierarchy.")
    }
    seen.add(cursor)
    const [row]: { parentAccountId: string | null }[] = await tx
      .select({ parentAccountId: accounts.parentAccountId })
      .from(accounts)
      .where(and(eq(accounts.id, cursor), isNull(accounts.deletedAt)))
      .limit(1)
    if (!row) throw new Error("Parent account not found")
    cursor = row.parentAccountId
  }
}

/**
 * Validate a reseller's end-user destination: it must exist (non-deleted) in
 * this tenant AND be a record the actor owns or manages — otherwise a reseller
 * could be linked to an account outside their visibility (cross-tenant/owner
 * write parity with the parent-account check). RLS already scopes the SELECT to
 * the tenant; this layer narrows within it.
 */
async function assertEndUserValid(
  tx: Tx,
  ctx: ServerContext,
  endUserAccountId: string
): Promise<void> {
  const [endUser] = await tx
    .select({ ownerMemberId: accounts.ownerMemberId })
    .from(accounts)
    .where(and(eq(accounts.id, endUserAccountId), isNull(accounts.deletedAt)))
    .limit(1)
  if (!endUser) throw new Error("End-user account not found")
  const visible = await visibleMemberIds(tx, ctx)
  if (!canManageAllRecords(ctx) && !ownsOrManages(visible, endUser.ownerMemberId)) {
    throw new Error("FORBIDDEN: not permitted on the chosen end-user account")
  }
}

export type SimilarAccount = { id: string; name: string }

/**
 * Near-miss duplicate check for the create form (pg_trgm similarity): catches
 * "ACME Sdn. Bhd." vs "Acme Sdn Bhd" that the exact-match guard can't. Warn-
 * only — the caller renders a notice, never a block. Degrades to [] when the
 * extension isn't installed yet (pre-migration environments).
 */
export async function findSimilarAccounts(
  name: string
): Promise<SimilarAccount[]> {
  const q = name.trim()
  if (q.length < 3) return []
  try {
    return await withTenant(PERMISSIONS.ACCOUNT_CREATE, async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(
          and(
            isNull(accounts.deletedAt),
            sql`similarity(${accounts.name}, ${q}) > 0.4`,
            // The exact match is handled (blocked) by createAccount itself.
            sql`lower(${accounts.name}) <> lower(${q})`
          )
        )
        .orderBy(sql`similarity(${accounts.name}, ${q}) desc`)
        .limit(5)
      return rows
    })
  } catch {
    return []
  }
}

export async function createAccount(
  input: AccountInput
): Promise<ActionResult<AccountRow>> {
  return runAction(async () => {
    const row = await withTenant(PERMISSIONS.ACCOUNT_CREATE, async (tx, ctx) => {
      // Duplicate guard: an exact (case-insensitive) name match almost always
      // means the account already exists — block with a pointer instead of
      // silently forking the customer's history across two records.
      const [dup] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(
          and(
            sql`lower(${accounts.name}) = lower(${input.name.trim()})`,
            isNull(accounts.deletedAt)
          )
        )
        .limit(1)
      if (dup) {
        throw new Error(
          `An account named "${dup.name}" already exists — open it instead, or use a distinct name (e.g. add the branch or region).`
        )
      }

      // User-entered code is validated + uniqueness-checked; a blank code is
      // auto-generated from the name so accounts.code is always populated (it
      // feeds the project code).
      let code = normalizeCode(input.code)
      if (code) await assertCodeUnique(tx, ctx.tenantId, code)
      else code = await generateAccountCode(tx, ctx.tenantId, input.name)
      const parentAccountId = input.parentAccountId || null
      if (parentAccountId) await assertParentValid(tx, parentAccountId)
      const { accountType, endUserAccountId } = resolveAccountType(input)
      if (endUserAccountId) await assertEndUserValid(tx, ctx, endUserAccountId)

      const [created] = await tx
        .insert(accounts)
        .values({
          tenantId: ctx.tenantId,
          ownerMemberId: ctx.memberId,
          name: input.name,
          code,
          parentAccountId,
          accountType,
          endUserAccountId,
          industry: input.industry || null,
          website: input.website || null,
          phone: input.phone || null,
          registrationNumber: input.registrationNumber || null,
          billingAddress: cleanAddress(input.billingAddress),
        })
        .returning()
      await logActivity(tx, ctx, {
        entityType: "account",
        entityId: created.id,
        type: "system",
        subject: "Created",
      })
      await writeAudit(tx, ctx, {
        action: "account.create",
        entityType: "account",
        entityId: created.id,
        after: created,
      })
      return created
    })
    revalidatePath("/accounts")
    return row
  })
}

export async function updateAccount(
  id: string,
  input: AccountInput
): Promise<ActionResult<AccountRow>> {
  return runAction(async () => {
    if (input.parentAccountId && input.parentAccountId === id) {
      throw new Error("An account cannot be its own parent.")
    }

    const row = await withTenant(PERMISSIONS.ACCOUNT_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Account not found.")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      const code = normalizeCode(input.code)
      if (code) await assertCodeUnique(tx, ctx.tenantId, code, id)
      const parentAccountId = input.parentAccountId || null
      // Reject multi-level cycles (A→B→A) before persisting the new parent.
      if (parentAccountId) await assertParentValid(tx, parentAccountId, id)
      const { accountType, endUserAccountId } = resolveAccountType(input)
      if (endUserAccountId === id) {
        throw new Error("An account cannot be its own end user.")
      }
      if (endUserAccountId) await assertEndUserValid(tx, ctx, endUserAccountId)

      // Owner is full-replace like every other field: an omitted ownerMemberId
      // means "leave as-is", so it defaults to the current owner.
      const newOwnerMemberId =
        input.ownerMemberId !== undefined
          ? input.ownerMemberId
          : before.ownerMemberId

      const updated = {
        name: input.name,
        code,
        parentAccountId,
        accountType,
        endUserAccountId,
        ownerMemberId: newOwnerMemberId,
        industry: input.industry || null,
        website: input.website || null,
        phone: input.phone || null,
        registrationNumber: input.registrationNumber || null,
        billingAddress: cleanAddress(input.billingAddress),
        updatedAt: new Date(),
      }

      await tx.update(accounts).set(updated).where(eq(accounts.id, id))

      // Salesforce owner cascade: on an actual owner change, push the new owner
      // to the account's child persons/opportunities/funnels so record-scoped
      // access stays consistent. Skip no-ops and null owners (child owner
      // columns are NOT NULL — there's nothing valid to cascade).
      if (
        newOwnerMemberId &&
        newOwnerMemberId !== before.ownerMemberId
      ) {
        const cascaded = await cascadeAccountOwner(
          tx,
          ctx.tenantId,
          id,
          newOwnerMemberId
        )
        await writeAudit(tx, ctx, {
          action: "account.owner_cascaded",
          entityType: "account",
          entityId: id,
          before: { ownerMemberId: before.ownerMemberId },
          after: { newOwnerMemberId, ...cascaded },
        })
      }

      await recordChanges(tx, ctx, {
        entityType: "account",
        registryKey: "account",
        entityId: id,
        before,
        after: { ...before, ...updated },
        subject: "Account updated",
      })
      return { ...before, ...updated }
    })
    revalidatePath("/accounts")
    revalidatePath(`/accounts/${id}`)
    return row
  })
}

export async function deleteAccount(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.ACCOUNT_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Account not found.")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      // Soft-delete doesn't cascade, so block while active dependents exist —
      // otherwise contacts/funnels/projects would be orphaned under a
      // hidden account.
      const [contact] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.accountId, id), isNull(persons.deletedAt)))
        .limit(1)
      if (contact) {
        throw new Error(
          "Remove this account's contacts before deleting it."
        )
      }
      const [opp] = await tx
        .select({ id: funnels.id })
        .from(funnels)
        .where(and(eq(funnels.accountId, id), isNull(funnels.deletedAt)))
        .limit(1)
      if (opp) {
        throw new Error(
          "Close or remove this account's pipelines before deleting it."
        )
      }
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.accountId, id), isNull(projects.deletedAt)))
        .limit(1)
      if (project) {
        throw new Error(
          "Close or remove this account's projects before deleting it."
        )
      }
      // Self-references (parentAccountId / endUserAccountId) only FK-null on a
      // hard delete, so block while any active account still points here —
      // otherwise the hierarchy and reseller rollups resolve to a hidden row.
      const [child] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.parentAccountId, id), isNull(accounts.deletedAt))
        )
        .limit(1)
      if (child) {
        throw new Error(
          "Reassign this account's child accounts before deleting it."
        )
      }
      const [reseller] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.endUserAccountId, id), isNull(accounts.deletedAt))
        )
        .limit(1)
      if (reseller) {
        throw new Error(
          "This account is the end user for a reseller. Unlink it before deleting."
        )
      }

      await tx
        .update(accounts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(accounts.id, id))
      await writeAudit(tx, ctx, {
        action: "account.delete",
        entityType: "account",
        entityId: id,
        before,
      })
    })
    revalidatePath("/accounts")
  })
}

/** Reverse a soft delete (undo). Clears deletedAt for an account the caller owns/manages. */
export async function restoreAccount(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.ACCOUNT_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1)
      if (!before) throw new Error("Account not found.")
      if (!before.deletedAt) return // already active

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this account")
      }

      await tx
        .update(accounts)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(accounts.id, id))
      await writeAudit(tx, ctx, {
        action: "account.restore",
        entityType: "account",
        entityId: id,
        after: before,
      })
    })
    revalidatePath("/accounts")
  })
}

/**
 * Parent-account options for a form. Excludes the given account itself and all
 * of its descendants, so a parent can never be picked that would form a cycle.
 */
export async function listParentOptions(
  excludeId?: string
): Promise<{ id: string; name: string }[]> {
  return withTenant(PERMISSIONS.ACCOUNT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        parentAccountId: accounts.parentAccountId,
      })
      .from(accounts)
      .where(
        and(isNull(accounts.deletedAt), ownerScope(accounts.ownerMemberId, visible))
      )
      .orderBy(asc(accounts.name))
      .limit(LIST_LIMIT)

    if (!excludeId) return rows.map(({ id, name }) => ({ id, name }))

    // Build the descendant set of excludeId (self + transitive children) and
    // drop it from the options — picking any of them would create a cycle.
    const childrenOf = new Map<string, string[]>()
    for (const r of rows) {
      if (!r.parentAccountId) continue
      const arr = childrenOf.get(r.parentAccountId)
      if (arr) arr.push(r.id)
      else childrenOf.set(r.parentAccountId, [r.id])
    }
    const excluded = new Set<string>([excludeId])
    const stack = [excludeId]
    while (stack.length) {
      const cur = stack.pop() as string
      for (const child of childrenOf.get(cur) ?? []) {
        if (!excluded.has(child)) {
          excluded.add(child)
          stack.push(child)
        }
      }
    }

    return rows
      .filter((r) => !excluded.has(r.id))
      .map(({ id, name }) => ({ id, name }))
  })
}
