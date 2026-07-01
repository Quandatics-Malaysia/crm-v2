"use server"

import { and, eq, isNull, desc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, type Tx, type ServerContext } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { leads, accounts, persons, funnels, funnelStages } from "@/db/schema"
import { writeAudit } from "@/server/audit"
import { convertLead } from "@/server/services/conversion"
import { logActivity } from "@/server/services/activity"
import { runAction, type ActionResult } from "@/lib/action-result"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"

/** Largest page we ever return from a list endpoint (defense against unbounded scans). */
const LIST_LIMIT = 1000

/**
 * Validate a caller-supplied (funnelId, currentStageId) pair against the tenant:
 * the funnel must exist, and the stage must belong to it. A stage without a
 * funnel is rejected. Returns the normalized ids to persist.
 */
async function resolveFunnelStage(
  tx: Tx,
  ctx: ServerContext,
  funnelIdInput: string | null,
  stageIdInput: string | null
): Promise<{ funnelId: string | null; currentStageId: string | null }> {
  if (!funnelIdInput && !stageIdInput) {
    return { funnelId: null, currentStageId: null }
  }
  if (!funnelIdInput) throw new Error("A funnel is required to set a stage")

  const [funnel] = await tx
    .select({ id: funnels.id })
    .from(funnels)
    .where(and(eq(funnels.id, funnelIdInput), eq(funnels.tenantId, ctx.tenantId)))
    .limit(1)
  if (!funnel) throw new Error("Funnel not found")

  if (!stageIdInput) return { funnelId: funnel.id, currentStageId: null }

  const [stage] = await tx
    .select({ id: funnelStages.id })
    .from(funnelStages)
    .where(and(eq(funnelStages.id, stageIdInput), eq(funnelStages.funnelId, funnel.id)))
    .limit(1)
  if (!stage) throw new Error("Stage not found in this funnel")

  return { funnelId: funnel.id, currentStageId: stage.id }
}

export type Lead = typeof leads.$inferSelect

export type LeadInput = {
  name: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  status?: Lead["status"]
  funnelId?: string | null
  currentStageId?: string | null
}

function clean(v?: string | null): string | null {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

/**
 * Leads must carry a valid email — it becomes the contact's email on conversion,
 * so we enforce it at the source. Trims, then rejects empty or malformed input.
 * Mirrors the client-side zod rule in lead-form.tsx.
 */
function requireEmail(v?: string | null): string {
  const email = (v ?? "").trim()
  if (!email) throw new Error("Email is required")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email")
  return email
}

/** All non-deleted leads, newest first. */
export async function listLeads(): Promise<Lead[]> {
  return withTenant(PERMISSIONS.LEAD_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select()
      .from(leads)
      .where(and(isNull(leads.deletedAt), ownerScope(leads.ownerMemberId, visible)))
      .orderBy(desc(leads.createdAt))
      .limit(LIST_LIMIT)
  })
}

export type LeadDetail = {
  lead: Lead
  stageName: string | null
  funnelName: string | null
  accountName: string | null
  personName: string | null
}

/**
 * A single lead with resolved names for its current stage and the entities it
 * was converted into (account / person / funnel).
 */
export async function getLead(id: string): Promise<LeadDetail | null> {
  return withTenant(PERMISSIONS.LEAD_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!lead) return null
    if (!ownsOrManages(visible, lead.ownerMemberId)) return null

    let stageName: string | null = null
    if (lead.currentStageId) {
      const [stage] = await tx
        .select({ name: funnelStages.name })
        .from(funnelStages)
        .where(eq(funnelStages.id, lead.currentStageId))
        .limit(1)
      stageName = stage?.name ?? null
    }

    let funnelName: string | null = null
    if (lead.funnelId) {
      const [funnel] = await tx
        .select({ name: funnels.name })
        .from(funnels)
        .where(eq(funnels.id, lead.funnelId))
        .limit(1)
      funnelName = funnel?.name ?? null
    }

    let accountName: string | null = null
    if (lead.convertedAccountId) {
      const [acct] = await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, lead.convertedAccountId))
        .limit(1)
      accountName = acct?.name ?? null
    }

    let personName: string | null = null
    if (lead.convertedPersonId) {
      const [p] = await tx
        .select({ firstName: persons.firstName, lastName: persons.lastName })
        .from(persons)
        .where(eq(persons.id, lead.convertedPersonId))
        .limit(1)
      if (p) personName = [p.firstName, p.lastName].filter(Boolean).join(" ")
    }

    return { lead, stageName, funnelName, accountName, personName }
  })
}

export async function createLead(input: LeadInput): Promise<ActionResult<Lead>> {
  return runAction(async () => {
    if (!input.name?.trim()) throw new Error("Name is required")
    const email = requireEmail(input.email)

    const row = await withTenant(PERMISSIONS.LEAD_CREATE, async (tx, ctx) => {
      const { funnelId, currentStageId } = await resolveFunnelStage(
        tx,
        ctx,
        clean(input.funnelId),
        clean(input.currentStageId)
      )

      const [lead] = await tx
        .insert(leads)
        .values({
          tenantId: ctx.tenantId,
          name: input.name.trim(),
          companyName: clean(input.companyName),
          email,
          phone: clean(input.phone),
          source: clean(input.source),
          status: input.status ?? "new",
          funnelId,
          currentStageId,
          ownerMemberId: ctx.memberId,
        })
        .returning()

      await logActivity(tx, ctx, {
        entityType: "lead",
        entityId: lead.id,
        type: "system",
        subject: "Created",
      })

      await writeAudit(tx, ctx, {
        action: "lead.created",
        entityType: "lead",
        entityId: lead.id,
        after: lead,
      })
      return lead
    })

    revalidatePath("/leads")
    return row
  })
}

export async function updateLead(
  id: string,
  input: LeadInput
): Promise<ActionResult<Lead>> {
  return runAction(async () => {
    if (!input.name?.trim()) throw new Error("Name is required")
    const email = requireEmail(input.email)

    const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Lead not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")

      const { funnelId, currentStageId: nextStageId } = await resolveFunnelStage(
        tx,
        ctx,
        clean(input.funnelId),
        clean(input.currentStageId)
      )

      const [lead] = await tx
        .update(leads)
        .set({
          name: input.name.trim(),
          companyName: clean(input.companyName),
          email,
          phone: clean(input.phone),
          source: clean(input.source),
          status: input.status ?? before.status,
          funnelId,
          currentStageId: nextStageId,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id))
        .returning()

      await logActivity(tx, ctx, {
        entityType: "lead",
        entityId: id,
        type: "system",
        subject: "Updated",
      })

      // Record a dedicated stage-change activity when the stage moves.
      if (before.currentStageId !== nextStageId) {
        let toName = "—"
        if (nextStageId) {
          const [stage] = await tx
            .select({ name: funnelStages.name })
            .from(funnelStages)
            .where(eq(funnelStages.id, nextStageId))
            .limit(1)
          toName = stage?.name ?? "—"
        }
        await logActivity(tx, ctx, {
          entityType: "lead",
          entityId: id,
          type: "stage_change",
          subject: `Moved to ${toName}`,
        })
      }

      await writeAudit(tx, ctx, {
        action: "lead.updated",
        entityType: "lead",
        entityId: id,
        before,
        after: lead,
      })
      return lead
    })

    revalidatePath("/leads")
    revalidatePath(`/leads/${id}`)
    return row
  })
}

/** Move a lead to a pipeline stage and log a stage_change activity. */
export async function setLeadStage(
  id: string,
  stageId: string
): Promise<ActionResult<Lead>> {
  return runAction(async () => {
    const targetStageId = clean(stageId)
    if (!targetStageId) throw new Error("A stage is required")

    const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Lead not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")

      const [stage] = await tx
        .select({ id: funnelStages.id, name: funnelStages.name, funnelId: funnelStages.funnelId })
        .from(funnelStages)
        .where(eq(funnelStages.id, targetStageId))
        .limit(1)
      if (!stage) throw new Error("Stage not found")

      const [lead] = await tx
        .update(leads)
        .set({
          funnelId: stage.funnelId,
          currentStageId: stage.id,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id))
        .returning()

      if (before.currentStageId !== stage.id) {
        await logActivity(tx, ctx, {
          entityType: "lead",
          entityId: id,
          type: "stage_change",
          subject: `Moved to ${stage.name}`,
        })
      }

      await writeAudit(tx, ctx, {
        action: "lead.stage_changed",
        entityType: "lead",
        entityId: id,
        before,
        after: lead,
      })
      return lead
    })

    revalidatePath("/leads")
    revalidatePath(`/leads/${id}`)
    return row
  })
}

/** Soft delete — never hard DELETE. */
export async function deleteLead(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.LEAD_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Lead not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")

      await tx
        .update(leads)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(leads.id, id))

      await writeAudit(tx, ctx, {
        action: "lead.deleted",
        entityType: "lead",
        entityId: id,
        before,
      })
    })

    revalidatePath("/leads")
  })
}

/** Reverse a soft delete (undo). Clears deletedAt for a lead the caller owns/manages. */
export async function restoreLead(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.LEAD_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(eq(leads.id, id))
        .limit(1)
      if (!before) throw new Error("Lead not found")
      if (!before.deletedAt) return // already active

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")

      await tx
        .update(leads)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(leads.id, id))

      await writeAudit(tx, ctx, {
        action: "lead.restored",
        entityType: "lead",
        entityId: id,
        after: before,
      })
    })

    revalidatePath("/leads")
  })
}

export async function disqualifyLead(
  id: string,
  reason: string
): Promise<ActionResult<Lead>> {
  return runAction(async () => {
    const trimmed = (reason ?? "").trim()
    if (!trimmed) throw new Error("A reason is required to disqualify")

    const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Lead not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, before.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")

      if (before.status === "converted")
        throw new Error("Converted leads cannot be disqualified")

      const [lead] = await tx
        .update(leads)
        .set({
          status: "disqualified",
          disqualifyReason: trimmed,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, id))
        .returning()

      await logActivity(tx, ctx, {
        entityType: "lead",
        entityId: id,
        type: "system",
        subject: "Disqualified",
        body: trimmed,
      })

      await writeAudit(tx, ctx, {
        action: "lead.disqualified",
        entityType: "lead",
        entityId: id,
        before,
        after: lead,
      })
      return lead
    })

    revalidatePath("/leads")
    revalidatePath(`/leads/${id}`)
    return row
  })
}

/** Details captured for the account created during conversion (new-account path). */
export type ConvertNewAccountInput = {
  accountType?: "client" | "reseller" | null
  phone?: string | null
  address?: {
    line1?: string | null
    line2?: string | null
    city?: string | null
    state?: string | null
    postcode?: string | null
    country?: string | null
  } | null
}

export type ConvertLeadInput = {
  leadId: string
  createOpportunity?: boolean
  opportunityName?: string | null
  expectedCloseDate?: string | null
  existingAccountId?: string | null
  /** Used only when no existingAccountId is given (creating a new account). */
  newAccount?: ConvertNewAccountInput | null
}

export async function convertLeadAction(input: ConvertLeadInput) {
  return runAction(async () => {
    const ctx = await requireContext()
    // Authorization is enforced by the convert permission before the service runs.
    if (!ctx.can(PERMISSIONS.LEAD_CONVERT))
      throw new Error(`FORBIDDEN: missing ${PERMISSIONS.LEAD_CONVERT}`)

    // Record-level gate: only convert a lead the caller owns/manages (or is elevated).
    await withTenant(PERMISSIONS.LEAD_CONVERT, async (tx, gateCtx) => {
      const visible = await visibleMemberIds(tx, gateCtx)
      const [src] = await tx
        .select({ ownerMemberId: leads.ownerMemberId })
        .from(leads)
        .where(and(eq(leads.id, input.leadId), isNull(leads.deletedAt)))
        .limit(1)
      if (!src) throw new Error("Lead not found")
      if (!canManageAllRecords(gateCtx) && !ownsOrManages(visible, src.ownerMemberId))
        throw new Error("FORBIDDEN: not permitted on this lead")
    })

    const result = await convertLead(ctx, {
      leadId: input.leadId,
      createOpportunity: input.createOpportunity,
      opportunityName: clean(input.opportunityName) ?? undefined,
      expectedCloseDate: clean(input.expectedCloseDate),
      existingAccountId: clean(input.existingAccountId),
      newAccount: input.existingAccountId ? null : input.newAccount ?? null,
    })

    revalidatePath("/leads")
    revalidatePath(`/leads/${input.leadId}`)
    return result
  })
}
