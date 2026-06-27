"use server"

import { and, asc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import type { StageCode, StageKind } from "./constants"
import { runInTenant, type Tx } from "@/db"
import { requireContext, assertCan, type ServerContext } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import { PERMISSIONS } from "@/lib/permissions"
import {
  tenantSettings,
  membershipProfiles,
  roles,
  member,
  user,
  funnels,
  funnelStages,
  opportunities,
} from "@/db/schema"

export type TenantSettingsView = {
  organizationId: string
  defaultCurrency: string
  status: string
  fiscalYearStartMonth: number
  approvalBypassTier: number
  taxInclusive: boolean
  autoWinOnQuoteAccept: boolean
  allowPasswordLogin: boolean
  entityCode: string
  quotePrefix: string
  quoteNextNumber: number
  quotePadWidth: number
  projectNextNumber: number
  projectPadWidth: number
  industries: string[]
}

export type TenantMemberView = {
  memberId: string
  name: string
  email: string
  roleName: string | null
  tierLevel: number
  status: string
}

export type UpdateSettingsInput = {
  defaultCurrency: string
  fiscalYearStartMonth: number
  approvalBypassTier: number
  taxInclusive: boolean
  autoWinOnQuoteAccept: boolean
  allowPasswordLogin: boolean
  entityCode: string
}

export type UpdateNumberingInput = {
  quotePrefix: string
  quoteNextNumber: number
  quotePadWidth: number
  projectNextNumber: number
  projectPadWidth: number
}

const DEFAULTS = {
  defaultCurrency: "MYR",
  status: "active" as const,
  fiscalYearStartMonth: 1,
  approvalBypassTier: 40,
  taxInclusive: false,
  autoWinOnQuoteAccept: true,
  // Default sign-in on so a self-service tenant can't be locked out; SSO-only
  // is an explicit opt-out via the General settings toggle.
  allowPasswordLogin: true,
}

/** Tenant settings for the active org. Creates a default row if missing. */
export async function getSettings(): Promise<TenantSettingsView> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
  return runInTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    if (!row) {
      const [created] = await tx
        .insert(tenantSettings)
        .values({ organizationId: ctx.tenantId, ...DEFAULTS })
        .returning()
      return toView(created)
    }
    return toView(row)
  })
}

function toView(row: typeof tenantSettings.$inferSelect): TenantSettingsView {
  return {
    organizationId: row.organizationId,
    defaultCurrency: row.defaultCurrency,
    status: row.status,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    approvalBypassTier: row.approvalBypassTier,
    taxInclusive: row.taxInclusive,
    autoWinOnQuoteAccept: row.autoWinOnQuoteAccept,
    allowPasswordLogin: row.allowPasswordLogin,
    entityCode: row.entityCode ?? "",
    quotePrefix: row.quotePrefix,
    quoteNextNumber: row.quoteNextNumber,
    quotePadWidth: row.quotePadWidth,
    projectNextNumber: row.projectNextNumber,
    projectPadWidth: row.projectPadWidth,
    industries: row.industries ?? [],
  }
}

/** Update (upsert) the general tenant settings row. */
export async function updateSettings(
  input: UpdateSettingsInput
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  const currency = (input.defaultCurrency ?? "").trim().toUpperCase()
  if (currency.length !== 3) {
    throw new Error("Currency must be a 3-letter ISO code (e.g. MYR).")
  }
  if (
    !Number.isInteger(input.fiscalYearStartMonth) ||
    input.fiscalYearStartMonth < 1 ||
    input.fiscalYearStartMonth > 12
  ) {
    throw new Error("Fiscal year start month must be between 1 and 12.")
  }
  if (!Number.isInteger(input.approvalBypassTier) || input.approvalBypassTier < 0) {
    throw new Error("Approval bypass tier must be a non-negative integer.")
  }

  const entityCode = (input.entityCode ?? "").trim().toUpperCase()

  const values = {
    defaultCurrency: currency,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    approvalBypassTier: input.approvalBypassTier,
    taxInclusive: input.taxInclusive,
    autoWinOnQuoteAccept: input.autoWinOnQuoteAccept,
    allowPasswordLogin: input.allowPasswordLogin,
    entityCode: entityCode.length > 0 ? entityCode : null,
    updatedAt: new Date(),
  }

  const view = await runInTenant(ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .insert(tenantSettings)
      .values({ organizationId: ctx.tenantId, status: "active", ...values })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: values,
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: values,
    })
    return toView(updated)
  })

  revalidatePath("/settings")
  return view
  })
}

/** Update quotation + project numbering configuration. */
export async function updateNumbering(
  input: UpdateNumberingInput
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  const quotePrefix = (input.quotePrefix ?? "").trim()
  if (quotePrefix.length === 0) {
    throw new Error("Quotation prefix is required.")
  }
  for (const [label, n] of [
    ["Quotation next number", input.quoteNextNumber],
    ["Project next number", input.projectNextNumber],
  ] as const) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`${label} must be a positive integer.`)
    }
  }
  for (const [label, n] of [
    ["Quotation pad width", input.quotePadWidth],
    ["Project pad width", input.projectPadWidth],
  ] as const) {
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(`${label} must be between 1 and 10.`)
    }
  }

  const values = {
    quotePrefix,
    quoteNextNumber: input.quoteNextNumber,
    quotePadWidth: input.quotePadWidth,
    projectNextNumber: input.projectNextNumber,
    projectPadWidth: input.projectPadWidth,
    updatedAt: new Date(),
  }

  const view = await runInTenant(ctx.tenantId, async (tx) => {
    // The stored counter is always (highest issued number + 1). Lowering it
    // below the current value would re-issue numbers already on live documents
    // and surface later as cryptic unique-constraint failures.
    const [current] = await tx
      .select({
        quoteNextNumber: tenantSettings.quoteNextNumber,
        projectNextNumber: tenantSettings.projectNextNumber,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    if (current) {
      if (input.quoteNextNumber < current.quoteNextNumber) {
        throw new Error(
          `Quotation next number can't go below ${current.quoteNextNumber} — number ${current.quoteNextNumber - 1} has already been issued.`
        )
      }
      if (input.projectNextNumber < current.projectNextNumber) {
        throw new Error(
          `Project next number can't go below ${current.projectNextNumber} — number ${current.projectNextNumber - 1} has already been issued.`
        )
      }
    }
    const [updated] = await tx
      .insert(tenantSettings)
      .values({ organizationId: ctx.tenantId, status: "active", ...values })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: values,
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.numbering_updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: values,
    })
    return toView(updated)
  })

  revalidatePath("/settings")
  return view
  })
}

/** Replace the configurable industry picklist for the tenant. */
export async function updateIndustries(
  industries: string[]
): Promise<ActionResult<string[]>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const raw of industries) {
    const name = (raw ?? "").trim()
    if (name.length === 0) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(name)
  }
  cleaned.sort((a, b) => a.localeCompare(b))

  const saved = await runInTenant(ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .insert(tenantSettings)
      .values({ organizationId: ctx.tenantId, status: "active", industries: cleaned })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: { industries: cleaned, updatedAt: new Date() },
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.industries_updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: { industries: cleaned },
    })
    return updated.industries ?? []
  })

  revalidatePath("/settings")
  return saved
  })
}

/** Members of the active tenant with their role + seniority tier. */
export async function listTenantMembers(): Promise<TenantMemberView[]> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
  return runInTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        memberId: member.id,
        name: user.name,
        email: user.email,
        roleName: roles.name,
        tierLevel: membershipProfiles.tierLevel,
        status: membershipProfiles.status,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .leftJoin(membershipProfiles, eq(membershipProfiles.memberId, member.id))
      .leftJoin(roles, eq(membershipProfiles.roleId, roles.id))
      .where(eq(member.organizationId, ctx.tenantId))

    return rows.map((r) => ({
      memberId: r.memberId,
      name: r.name,
      email: r.email,
      roleName: r.roleName ?? null,
      tierLevel: r.tierLevel ?? 0,
      status: r.status ?? "active",
    }))
  })
}

// ─── Funnel stages (default funnel) ──────────────────────────────────────────

export type FunnelStageRow = typeof funnelStages.$inferSelect

export type DefaultFunnelView = {
  funnelId: string | null
  funnelName: string | null
  stages: FunnelStageRow[]
}

export type StageUpdateInput = {
  name: string
  probability: string
  requiresApprovalToEnter: boolean
  includeInForecast: boolean
  sortOrder: number
}

export type StageCreateInput = StageUpdateInput & {
  code: StageCode
  kind: StageKind
}

/** Resolve the tenant's default funnel id (falls back to first active funnel). */
async function resolveDefaultFunnelId(
  tx: Tx,
  tenantId: string
): Promise<string | null> {
  const all = await tx
    .select()
    .from(funnels)
    .where(eq(funnels.tenantId, tenantId))
    .orderBy(asc(funnels.name))
  const def = all.find((f) => f.isDefault) ?? all.find((f) => f.isActive) ?? all[0]
  return def?.id ?? null
}

/** The default funnel and its stages, ordered by sortOrder. */
export async function getDefaultFunnel(): Promise<DefaultFunnelView> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
  return runInTenant(ctx.tenantId, async (tx) => {
    const all = await tx
      .select()
      .from(funnels)
      .where(eq(funnels.tenantId, ctx.tenantId))
      .orderBy(asc(funnels.name))
    const def =
      all.find((f) => f.isDefault) ?? all.find((f) => f.isActive) ?? all[0]
    if (!def) return { funnelId: null, funnelName: null, stages: [] }
    const stages = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.funnelId, def.id))
      .orderBy(asc(funnelStages.sortOrder))
    return { funnelId: def.id, funnelName: def.name, stages }
  })
}

function validateStage(input: StageUpdateInput) {
  if (input.name.trim().length === 0) {
    throw new Error("Stage name is required.")
  }
  const prob = Number(input.probability)
  if (!Number.isFinite(prob) || prob < 0 || prob > 100) {
    throw new Error("Probability must be between 0 and 100.")
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new Error("Sort order must be a non-negative integer.")
  }
}

export async function updateStage(
  id: string,
  input: StageUpdateInput
): Promise<ActionResult<FunnelStageRow>> {
  return runAction(async () => {
  validateStage(input)
  const row = await withStageTenant(async (tx, ctx) => {
    const [updated] = await tx
      .update(funnelStages)
      .set({
        name: input.name.trim(),
        probability: input.probability,
        requiresApprovalToEnter: input.requiresApprovalToEnter,
        includeInForecast: input.includeInForecast,
        sortOrder: input.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(funnelStages.id, id))
      .returning()
    if (!updated) throw new Error("Stage not found.")
    await writeAudit(tx, ctx, {
      action: "stage.updated",
      entityType: "funnel_stage",
      entityId: id,
      after: updated,
    })
    return updated
  })
  revalidatePath("/settings")
  return row
  })
}

export async function createStage(
  input: StageCreateInput
): Promise<ActionResult<FunnelStageRow>> {
  return runAction(async () => {
  validateStage(input)
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FUNNEL_MANAGE)
  const row = await runInTenant(ctx.tenantId, async (tx) => {
    const funnelId = await resolveDefaultFunnelId(tx, ctx.tenantId)
    if (!funnelId) throw new Error("No funnel configured for this entity.")

    const existing = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.funnelId, funnelId))
    if (existing.some((s) => s.code === input.code)) {
      throw new Error(`Stage code "${input.code}" already exists in this funnel.`)
    }
    if (existing.some((s) => s.sortOrder === input.sortOrder)) {
      throw new Error(`Sort order ${input.sortOrder} is already used.`)
    }

    const [created] = await tx
      .insert(funnelStages)
      .values({
        tenantId: ctx.tenantId,
        funnelId,
        code: input.code,
        name: input.name.trim(),
        probability: input.probability,
        kind: input.kind,
        sortOrder: input.sortOrder,
        requiresApprovalToEnter: input.requiresApprovalToEnter,
        includeInForecast: input.includeInForecast,
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "stage.created",
      entityType: "funnel_stage",
      entityId: created.id,
      after: created,
    })
    return created
  })
  revalidatePath("/settings")
  return row
  })
}

export async function deleteStage(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withStageTenant(async (tx, ctx) => {
    const [before] = await tx
      .select()
      .from(funnelStages)
      .where(eq(funnelStages.id, id))
      .limit(1)
    if (!before) throw new Error("Stage not found.")

    // Refuse to orphan live deals: a stage with non-deleted opportunities
    // referencing it can't be hard-deleted (it would break the board + forecast).
    const inUse = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.currentStageId, id),
          isNull(opportunities.deletedAt)
        )
      )
      .limit(1)
    if (inUse.length > 0) {
      throw new Error(
        "This stage still has funnels in it. Move them to another stage before deleting it."
      )
    }

    await tx.delete(funnelStages).where(eq(funnelStages.id, id))
    await writeAudit(tx, ctx, {
      action: "stage.deleted",
      entityType: "funnel_stage",
      entityId: id,
      before: before ?? null,
    })
  })
  revalidatePath("/settings")
  })
}

/**
 * Persist a new ordering. `order` is an array of stage ids in the desired
 * sequence; sortOrder is rewritten to match the index (offset to avoid the
 * unique (funnelId, sortOrder) constraint mid-update).
 */
export async function reorderStages(order: string[]): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FUNNEL_MANAGE)
  await runInTenant(ctx.tenantId, async (tx) => {
    const funnelId = await resolveDefaultFunnelId(tx, ctx.tenantId)
    if (!funnelId) throw new Error("No funnel configured for this entity.")
    // Two-phase write to dodge the (funnelId, sortOrder) unique constraint.
    const OFFSET = 1000
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(funnelStages)
        .set({ sortOrder: i + OFFSET, updatedAt: new Date() })
        .where(
          and(eq(funnelStages.id, order[i]), eq(funnelStages.funnelId, funnelId))
        )
    }
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(funnelStages)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(eq(funnelStages.id, order[i]), eq(funnelStages.funnelId, funnelId))
        )
    }
    await writeAudit(tx, ctx, {
      action: "stage.reordered",
      entityType: "funnel",
      entityId: funnelId,
      after: { order },
    })
  })
  revalidatePath("/settings")
  })
}

/** Shared wrapper for stage mutations gated by FUNNEL_MANAGE. */
async function withStageTenant<T>(
  fn: (tx: Tx, ctx: ServerContext) => Promise<T>
): Promise<T> {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FUNNEL_MANAGE)
  return runInTenant(ctx.tenantId, (tx) => fn(tx, ctx))
}
