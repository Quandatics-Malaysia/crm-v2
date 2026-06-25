"use server"

import { and, asc, desc, eq, isNull, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  quotations,
  quotationLineItems,
  opportunities,
  projects,
  taxSettings,
  tenantSettings,
} from "@/db/schema"
import { computeQuotation } from "@/server/services/quotation-math"
import { syncOpportunityAmount, quoteNet } from "@/server/services/value"
import { winOpportunity } from "@/server/services/stage"
import { nextQuoteNumber } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { writeAudit } from "@/server/audit"

export type QuotationRow = typeof quotations.$inferSelect
export type QuotationLineRow = typeof quotationLineItems.$inferSelect

export type QuotationListItem = QuotationRow & {
  opportunityName: string | null
}

export type LineInput = {
  description: string
  quantity: string
  unitPrice: string
  discountPercent: string
}

export type QuotationHeaderInput = {
  taxSettingId: string | null
  validUntil: string | null
  notes: string | null
  lines: LineInput[]
}

export type QuotationDetail = {
  quotation: QuotationRow
  lines: QuotationLineRow[]
  opportunityName: string | null
}

/** All non-deleted quotations with their opportunity name, newest first. */
export async function listQuotations(): Promise<QuotationListItem[]> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx) => {
    const rows = await tx
      .select({
        q: quotations,
        opportunityName: opportunities.name,
      })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(isNull(quotations.deletedAt))
      .orderBy(desc(quotations.createdAt))
    return rows.map((r) => ({ ...r.q, opportunityName: r.opportunityName }))
  })
}

export async function getQuotation(id: string): Promise<QuotationDetail | null> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx) => {
    const [row] = await tx
      .select({ q: quotations, opportunityName: opportunities.name })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!row) return null
    const lines = await tx
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, id))
      .orderBy(asc(quotationLineItems.sortOrder))
    return { quotation: row.q, lines, opportunityName: row.opportunityName }
  })
}

/**
 * The delivery project created from this quotation, if any.
 * Used on the detail page to cross-link to /projects/<id>.
 */
export async function getProjectForQuotation(
  quotationId: string
): Promise<{ id: string; projectCode: string; name: string } | null> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx) => {
    const [row] = await tx
      .select({
        id: projects.id,
        projectCode: projects.projectCode,
        name: projects.name,
      })
      .from(projects)
      .where(
        and(eq(projects.quotationId, quotationId), isNull(projects.deletedAt))
      )
      .orderBy(desc(projects.createdAt))
      .limit(1)
    return row ?? null
  })
}

/** Open opportunities for the "new quotation" picker. */
export async function listOpportunityOptions(): Promise<
  { id: string; name: string }[]
> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, (tx) =>
    tx
      .select({ id: opportunities.id, name: opportunities.name })
      .from(opportunities)
      .where(isNull(opportunities.deletedAt))
      .orderBy(asc(opportunities.name))
  )
}

async function resolveTaxRate(
  tx: Tx,
  taxSettingId: string | null
): Promise<string | null> {
  if (!taxSettingId) return null
  const [tax] = await tx
    .select({ ratePercent: taxSettings.ratePercent })
    .from(taxSettings)
    .where(eq(taxSettings.id, taxSettingId))
    .limit(1)
  return tax?.ratePercent ?? null
}

async function loadTaxInclusive(
  tx: Tx,
  tenantId: string
): Promise<boolean> {
  const [settings] = await tx
    .select({ taxInclusive: tenantSettings.taxInclusive })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  return settings?.taxInclusive ?? false
}

export async function createQuotation(input: {
  opportunityId: string
  taxSettingId: string | null
  validUntil: string | null
  notes: string | null
  lines: LineInput[]
}): Promise<QuotationRow> {
  const row = await withTenant(PERMISSIONS.QUOTATION_CREATE, async (tx, ctx) => {
    const [opp] = await tx
      .select({
        id: opportunities.id,
        currency: opportunities.currency,
        primaryQuotationId: opportunities.primaryQuotationId,
      })
      .from(opportunities)
      .where(and(eq(opportunities.id, input.opportunityId), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!opp) throw new Error("Funnel not found")

    const ratePercent = await resolveTaxRate(tx, input.taxSettingId)
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    const totals = computeQuotation({
      lines: input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      ratePercent: ratePercent ?? 0,
      taxInclusive,
    })

    const quoteNumber = await nextQuoteNumber(tx, ctx)

    const [created] = await tx
      .insert(quotations)
      .values({
        tenantId: ctx.tenantId,
        opportunityId: input.opportunityId,
        quoteNumber,
        status: "draft",
        currency: opp.currency,
        taxSettingId: input.taxSettingId,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        taxTotal: totals.taxTotal.toFixed(2),
        total: totals.total.toFixed(2),
        validUntil: input.validUntil || null,
        notes: input.notes || null,
      })
      .returning()

    await insertLines(tx, ctx.tenantId, created.id, input.lines, totals, input.taxSettingId)

    // If the opportunity has no primary quotation yet, this new quote becomes
    // primary so the opportunity's amount derives from its net.
    if (!opp.primaryQuotationId) {
      await tx
        .update(quotations)
        .set({ isPrimary: true })
        .where(eq(quotations.id, created.id))
      await tx
        .update(opportunities)
        .set({ primaryQuotationId: created.id, updatedAt: new Date() })
        .where(eq(opportunities.id, input.opportunityId))
      await syncOpportunityAmount(tx, ctx, input.opportunityId)
    }

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: input.opportunityId,
      type: "system",
      subject: `Quotation ${created.quoteNumber} created`,
    })

    await writeAudit(tx, ctx, {
      action: "quotation.created",
      entityType: "quotation",
      entityId: created.id,
      after: { quoteNumber: created.quoteNumber, total: created.total },
    })
    return created
  })
  revalidatePath("/quotations")
  return row
}

export async function updateQuotation(
  id: string,
  input: QuotationHeaderInput
): Promise<QuotationRow> {
  const row = await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Quotation not found")
    if (existing.status !== "draft")
      throw new Error("Only draft quotations can be edited")

    const ratePercent = await resolveTaxRate(tx, input.taxSettingId)
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    const totals = computeQuotation({
      lines: input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      ratePercent: ratePercent ?? 0,
      taxInclusive,
    })

    const [updated] = await tx
      .update(quotations)
      .set({
        taxSettingId: input.taxSettingId,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        taxTotal: totals.taxTotal.toFixed(2),
        total: totals.total.toFixed(2),
        validUntil: input.validUntil || null,
        notes: input.notes || null,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
      .returning()

    // Replace line items (delete + reinsert).
    await tx.delete(quotationLineItems).where(eq(quotationLineItems.quotationId, id))
    await insertLines(tx, ctx.tenantId, id, input.lines, totals, input.taxSettingId)

    // If this quote is the opportunity's primary, keep amount == its net.
    if (existing.isPrimary) {
      await syncOpportunityAmount(tx, ctx, existing.opportunityId)
    }

    await writeAudit(tx, ctx, {
      action: "quotation.updated",
      entityType: "quotation",
      entityId: id,
      after: { total: updated.total },
    })
    return updated
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  return row
}

async function insertLines(
  tx: Tx,
  tenantId: string,
  quotationId: string,
  lines: LineInput[],
  totals: ReturnType<typeof computeQuotation>,
  taxSettingId: string | null
): Promise<void> {
  if (lines.length === 0) return
  await tx.insert(quotationLineItems).values(
    lines.map((l, i) => ({
      tenantId,
      quotationId,
      description: l.description,
      quantity: l.quantity || "0",
      unitPrice: l.unitPrice || "0",
      discountPercent: l.discountPercent || "0",
      taxSettingId,
      lineSubtotal: totals.lines[i].lineSubtotal.toFixed(2),
      lineTax: totals.lines[i].lineTax.toFixed(2),
      lineTotal: totals.lines[i].lineTotal.toFixed(2),
      sortOrder: i,
    }))
  )
}

export async function sendQuotation(id: string): Promise<void> {
  await withTenant(PERMISSIONS.QUOTATION_SEND, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    if (q.status !== "draft")
      throw new Error("Only draft quotations can be sent")

    const ratePercent = await resolveTaxRate(tx, q.taxSettingId)
    await tx
      .update(quotations)
      .set({
        status: "sent",
        sentAt: new Date(),
        taxRateSnapshot: ratePercent,
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))
    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: q.opportunityId,
      type: "system",
      subject: `Quotation ${q.quoteNumber} sent`,
    })
    await writeAudit(tx, ctx, {
      action: "quotation.sent",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
}

export async function acceptQuotation(id: string): Promise<void> {
  const result = await withTenant(PERMISSIONS.QUOTATION_ACCEPT, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    if (q.status !== "sent")
      throw new Error("Only sent quotations can be accepted")

    await tx
      .update(quotations)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotations.id, id))

    // This quotation becomes the opportunity's primary; clear siblings.
    await tx
      .update(quotations)
      .set({ isPrimary: false })
      .where(
        and(eq(quotations.opportunityId, q.opportunityId), ne(quotations.id, id))
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true })
      .where(eq(quotations.id, id))

    // Set primary then derive amount from the primary quote's net.
    await tx
      .update(opportunities)
      .set({ primaryQuotationId: id, updatedAt: new Date() })
      .where(eq(opportunities.id, q.opportunityId))
    await syncOpportunityAmount(tx, ctx, q.opportunityId)

    const [settings] = await tx
      .select({ autoWin: tenantSettings.autoWinOnQuoteAccept })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: q.opportunityId,
      type: "system",
      subject: `Quotation ${q.quoteNumber} accepted`,
    })

    await writeAudit(tx, ctx, {
      action: "quotation.accepted",
      entityType: "quotation",
      entityId: id,
      after: { opportunityId: q.opportunityId, amount: quoteNet(q) },
    })

    return {
      opportunityId: q.opportunityId,
      autoWin: settings?.autoWin ?? false,
    }
  })

  if (result.autoWin) {
    const ctx = await requireContext()
    await winOpportunity(ctx, result.opportunityId)
  }

  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
}

export async function rejectQuotation(id: string): Promise<void> {
  await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    if (q.status !== "sent")
      throw new Error("Only sent quotations can be rejected")
    await tx
      .update(quotations)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(quotations.id, id))
    await writeAudit(tx, ctx, {
      action: "quotation.rejected",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
}

export async function setPrimaryQuotation(id: string): Promise<void> {
  await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    await tx
      .update(quotations)
      .set({ isPrimary: false })
      .where(
        and(eq(quotations.opportunityId, q.opportunityId), ne(quotations.id, id))
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(quotations.id, id))
    await tx
      .update(opportunities)
      .set({ primaryQuotationId: id, updatedAt: new Date() })
      .where(eq(opportunities.id, q.opportunityId))
    await syncOpportunityAmount(tx, ctx, q.opportunityId)
    await writeAudit(tx, ctx, {
      action: "quotation.set_primary",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
}

export async function deleteQuotation(id: string): Promise<void> {
  await withTenant(PERMISSIONS.QUOTATION_DELETE, async (tx, ctx) => {
    const [updated] = await tx
      .update(quotations)
      .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) throw new Error("Quotation not found")
    await writeAudit(tx, ctx, {
      action: "quotation.deleted",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
}
