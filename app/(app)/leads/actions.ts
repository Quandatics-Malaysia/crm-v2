"use server"

import { and, eq, isNull, desc } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { leads, accounts, persons, funnels, funnelStages } from "@/db/schema"
import { writeAudit } from "@/server/audit"
import { convertLead } from "@/server/services/conversion"
import { logActivity } from "@/server/services/activity"

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

/** All non-deleted leads, newest first. */
export async function listLeads(): Promise<Lead[]> {
  return withTenant(PERMISSIONS.LEAD_VIEW, (tx) =>
    tx
      .select()
      .from(leads)
      .where(isNull(leads.deletedAt))
      .orderBy(desc(leads.createdAt))
  )
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
  return withTenant(PERMISSIONS.LEAD_VIEW, async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!lead) return null

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

export async function createLead(input: LeadInput): Promise<Lead> {
  if (!input.name?.trim()) throw new Error("Name is required")

  const row = await withTenant(PERMISSIONS.LEAD_CREATE, async (tx, ctx) => {
    const [lead] = await tx
      .insert(leads)
      .values({
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        companyName: clean(input.companyName),
        email: clean(input.email),
        phone: clean(input.phone),
        source: clean(input.source),
        status: input.status ?? "new",
        funnelId: clean(input.funnelId),
        currentStageId: clean(input.currentStageId),
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
}

export async function updateLead(id: string, input: LeadInput): Promise<Lead> {
  if (!input.name?.trim()) throw new Error("Name is required")

  const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
    const [before] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!before) throw new Error("Lead not found")

    const nextStageId = clean(input.currentStageId)

    const [lead] = await tx
      .update(leads)
      .set({
        name: input.name.trim(),
        companyName: clean(input.companyName),
        email: clean(input.email),
        phone: clean(input.phone),
        source: clean(input.source),
        status: input.status ?? before.status,
        funnelId: clean(input.funnelId),
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
}

/** Move a lead to a pipeline stage and log a stage_change activity. */
export async function setLeadStage(id: string, stageId: string): Promise<Lead> {
  const targetStageId = clean(stageId)
  if (!targetStageId) throw new Error("A stage is required")

  const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
    const [before] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!before) throw new Error("Lead not found")

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
}

/** Soft delete — never hard DELETE. */
export async function deleteLead(id: string): Promise<void> {
  await withTenant(PERMISSIONS.LEAD_DELETE, async (tx, ctx) => {
    const [before] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!before) throw new Error("Lead not found")

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
}

export async function disqualifyLead(id: string, reason: string): Promise<Lead> {
  const trimmed = (reason ?? "").trim()
  if (!trimmed) throw new Error("A reason is required to disqualify")

  const row = await withTenant(PERMISSIONS.LEAD_UPDATE, async (tx, ctx) => {
    const [before] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
      .limit(1)
    if (!before) throw new Error("Lead not found")
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
}

export type ConvertLeadInput = {
  leadId: string
  createOpportunity?: boolean
  opportunityName?: string | null
  expectedCloseDate?: string | null
  existingAccountId?: string | null
}

export async function convertLeadAction(input: ConvertLeadInput) {
  const ctx = await requireContext()
  // Authorization is enforced by the convert permission before the service runs.
  if (!ctx.can(PERMISSIONS.LEAD_CONVERT))
    throw new Error(`FORBIDDEN: missing ${PERMISSIONS.LEAD_CONVERT}`)

  const result = await convertLead(ctx, {
    leadId: input.leadId,
    createOpportunity: input.createOpportunity,
    opportunityName: clean(input.opportunityName) ?? undefined,
    expectedCloseDate: clean(input.expectedCloseDate),
    existingAccountId: clean(input.existingAccountId),
  })

  revalidatePath("/leads")
  revalidatePath(`/leads/${input.leadId}`)
  return result
}
