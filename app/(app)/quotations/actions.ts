"use server"

import { and, asc, desc, eq, isNull, ne, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { assertValidQuotationNumbers } from "@/lib/validation-quotation"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
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
import { toDateString } from "@/lib/dates"

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
  headerDiscount?: string | null
  lines: LineInput[]
}

export type QuotationDetail = {
  quotation: QuotationRow
  lines: QuotationLineRow[]
  opportunityName: string | null
}

/** All non-deleted quotations with their opportunity name, newest first. */
export async function listQuotations(): Promise<QuotationListItem[]> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        q: quotations,
        opportunityName: opportunities.name,
      })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(
        and(
          isNull(quotations.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(desc(quotations.createdAt))
      .limit(500)
    return rows.map((r) => ({ ...r.q, opportunityName: r.opportunityName }))
  })
}

export async function getQuotation(id: string): Promise<QuotationDetail | null> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [row] = await tx
      .select({
        q: quotations,
        opportunityName: opportunities.name,
        oppOwner: opportunities.ownerMemberId,
      })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!row) return null
    if (!ownsOrManages(visible, row.oppOwner)) return null
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
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [scope] = await tx
      .select({ oppOwner: opportunities.ownerMemberId })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(and(eq(quotations.id, quotationId), isNull(quotations.deletedAt)))
      .limit(1)
    if (!scope || !ownsOrManages(visible, scope.oppOwner)) return null
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
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({ id: opportunities.id, name: opportunities.name })
      .from(opportunities)
      .where(
        and(
          isNull(opportunities.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(asc(opportunities.name))
  })
}

export type TaxOption = {
  id: string
  name: string
  ratePercent: string
  isDefault: boolean
}

/**
 * Tax settings + tenant tax-inclusive flag needed to render and live-preview a
 * quotation create form. Fetched on demand by the embeddable create dialog so
 * it can stand alone wherever it is triggered.
 */
export async function getQuotationFormMeta(): Promise<{
  taxOptions: TaxOption[]
  taxInclusive: boolean
}> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const taxOptions = await tx
      .select({
        id: taxSettings.id,
        name: taxSettings.name,
        ratePercent: taxSettings.ratePercent,
        isDefault: taxSettings.isDefault,
      })
      .from(taxSettings)
      .where(eq(taxSettings.isActive, true))
      .orderBy(asc(taxSettings.name))
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    return { taxOptions, taxInclusive }
  })
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
  headerDiscount?: string | null
  lines: LineInput[]
}): Promise<ActionResult<QuotationRow>> {
  return runAction(async () => {
  const row = await withTenant(PERMISSIONS.QUOTATION_CREATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        id: opportunities.id,
        currency: opportunities.currency,
        primaryQuotationId: opportunities.primaryQuotationId,
        ownerMemberId: opportunities.ownerMemberId,
      })
      .from(opportunities)
      .where(and(eq(opportunities.id, input.opportunityId), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!opp) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
      throw new Error("FORBIDDEN")

    const ratePercent = await resolveTaxRate(tx, input.taxSettingId)
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    assertValidQuotationNumbers({
      headerDiscount: input.headerDiscount,
      lines: input.lines,
      ratePercent: ratePercent ?? 0,
      taxInclusive,
    })
    const totals = computeQuotation({
      lines: input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      ratePercent: ratePercent ?? 0,
      headerDiscount: input.headerDiscount ?? 0,
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
        taxInclusive,
        subtotal: totals.subtotal.toFixed(2),
        headerDiscount: (Number(input.headerDiscount ?? 0) || 0).toFixed(2),
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
  })
}

export async function updateQuotation(
  id: string,
  input: QuotationHeaderInput
): Promise<ActionResult<QuotationRow>> {
  return runAction(async () => {
  const row = await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({ ownerMemberId: opportunities.ownerMemberId })
      .from(opportunities)
      .where(eq(opportunities.id, existing.opportunityId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    if (existing.status !== "draft")
      throw new Error("Only draft quotations can be edited")

    const ratePercent = await resolveTaxRate(tx, input.taxSettingId)
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    assertValidQuotationNumbers({
      headerDiscount: input.headerDiscount,
      lines: input.lines,
      ratePercent: ratePercent ?? 0,
      taxInclusive,
    })
    const headerDiscount = Number(input.headerDiscount ?? 0) || 0
    const totals = computeQuotation({
      lines: input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      ratePercent: ratePercent ?? 0,
      headerDiscount,
      taxInclusive,
    })

    const [updated] = await tx
      .update(quotations)
      .set({
        taxSettingId: input.taxSettingId,
        subtotal: totals.subtotal.toFixed(2),
        headerDiscount: headerDiscount.toFixed(2),
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
  })
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

export async function sendQuotation(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.QUOTATION_SEND, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        ownerMemberId: opportunities.ownerMemberId,
        status: opportunities.status,
      })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    if (q.status !== "draft")
      throw new Error("Only draft quotations can be sent")
    // The funnel must still be live: don't send proposals on won/lost/parked deals.
    if (opp && opp.status !== "open")
      throw new Error(
        "This funnel is no longer open, so its quotation can't be sent."
      )
    // Don't send an already-lapsed proposal.
    if (q.validUntil && q.validUntil < toDateString())
      throw new Error(
        `This quotation lapsed on ${q.validUntil}. Update “Valid until” before sending.`
      )

    // Freeze the document: snapshot the tax rate AND recompute + persist the
    // totals with that rate, so the sent quote no longer tracks the live tax
    // option or tenant tax-inclusive flag. The detail view renders the stored
    // columns for non-draft quotes.
    const ratePercent = await resolveTaxRate(tx, q.taxSettingId)
    const taxInclusive = await loadTaxInclusive(tx, ctx.tenantId)
    const storedLines = await tx
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, id))
      .orderBy(asc(quotationLineItems.sortOrder))
    const totals = computeQuotation({
      lines: storedLines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      ratePercent: ratePercent ?? 0,
      headerDiscount: q.headerDiscount,
      taxInclusive,
    })

    await tx
      .update(quotations)
      .set({
        status: "sent",
        sentAt: new Date(),
        taxRateSnapshot: ratePercent,
        taxInclusive,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        taxTotal: totals.taxTotal.toFixed(2),
        total: totals.total.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(quotations.id, id))

    // Re-persist the per-line breakdown so it reconciles to the frozen header.
    for (let i = 0; i < storedLines.length; i++) {
      const c = totals.lines[i]
      await tx
        .update(quotationLineItems)
        .set({
          lineSubtotal: c.lineSubtotal.toFixed(2),
          lineTax: c.lineTax.toFixed(2),
          lineTotal: c.lineTotal.toFixed(2),
        })
        .where(eq(quotationLineItems.id, storedLines[i].id))
    }

    // Keep the opportunity amount aligned if this is the primary quote.
    if (q.isPrimary) {
      await syncOpportunityAmount(tx, ctx, q.opportunityId)
    }

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
  })
}

export type AcceptQuotationResult = {
  opportunityId: string
  accountId: string
  /** Non-fatal warning when accept committed but the auto-win move failed. */
  warning?: string
  /**
   * True when auto-win was enabled but winning the funnel is gated behind an
   * approval request (the stage did NOT move yet). The UI uses this to say the
   * win is pending approval rather than presenting the deal as won.
   */
  pendingApproval?: boolean
}

export async function acceptQuotation(
  id: string
): Promise<ActionResult<AcceptQuotationResult>> {
  return runAction(async () => {
  const result = await withTenant(PERMISSIONS.QUOTATION_ACCEPT, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        ownerMemberId: opportunities.ownerMemberId,
        status: opportunities.status,
        accountId: opportunities.accountId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId))
      .limit(1)
    if (!opp) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    if (q.status !== "sent")
      throw new Error("Only sent quotations can be accepted")
    // The funnel must still be open: a won/lost/parked deal can't take a new
    // acceptance (this also prevents a second accepted quote on a won deal).
    if (opp.status !== "open")
      throw new Error(
        "This funnel is no longer open, so its quotation can't be accepted."
      )
    // Don't accept on lapsed terms.
    if (q.validUntil && q.validUntil < toDateString())
      throw new Error(
        `This quotation lapsed on ${q.validUntil}. Create a revision before accepting.`
      )
    // Only one accepted quotation per funnel.
    const [otherAccepted] = await tx
      .select({ id: quotations.id })
      .from(quotations)
      .where(
        and(
          eq(quotations.opportunityId, q.opportunityId),
          ne(quotations.id, id),
          isNull(quotations.deletedAt),
          eq(quotations.status, "accepted")
        )
      )
      .limit(1)
    if (otherAccepted)
      throw new Error(
        "Another quotation has already been accepted for this funnel."
      )

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
      accountId: opp.accountId,
      autoWin: settings?.autoWin ?? false,
    }
  })

  // Auto-win runs in its own transaction AFTER acceptance committed, so a
  // failure here must not surface as an overall failure (the quote is already
  // accepted + primary). Treat it as a non-fatal warning the caller can show.
  let warning: string | undefined
  let pendingApproval = false
  if (result.autoWin) {
    try {
      const ctx = await requireContext()
      // winOpportunity reports whether it moved the stage to Won or instead
      // raised an approval request (Won is approval-gated for this actor). The
      // cast bridges the additive contract while the stage service is updated
      // to return `{ moved, pendingApproval }`; older `void` returns read as
      // "not pending", preserving the prior behaviour.
      const winResult = (await winOpportunity(ctx, result.opportunityId)) as
        | unknown
        | void
      pendingApproval = !!(
        winResult &&
        typeof winResult === "object" &&
        "pendingApproval" in winResult &&
        (winResult as { pendingApproval?: boolean }).pendingApproval
      )
    } catch (e) {
      console.error("[acceptQuotation] auto-win failed", e)
      warning =
        "Quotation accepted, but moving the funnel to Won failed — advance the stage manually."
    }
  }

  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  return {
    opportunityId: result.opportunityId,
    accountId: result.accountId,
    warning,
    pendingApproval,
  }
  })
}

export async function rejectQuotation(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({ ownerMemberId: opportunities.ownerMemberId })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    if (q.status !== "sent")
      throw new Error("Only sent quotations can be rejected")
    await tx
      .update(quotations)
      .set({ status: "rejected", isPrimary: false, updatedAt: new Date() })
      .where(eq(quotations.id, id))
    // A rejected quote must not keep driving the opportunity value: if it was
    // the primary, promote another live quote (or clear) and re-sync.
    await reassignPrimaryAfterRemoval(tx, ctx, q.opportunityId, id)
    await writeAudit(tx, ctx, {
      action: "quotation.rejected",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  })
}

/**
 * After a quote leaves the live set (deleted or rejected), if it was the
 * opportunity's primary, promote another non-deleted, non-terminal quote (most
 * recent first) — or clear the pointer when none remain — then re-sync the
 * opportunity amount from the new primary's net.
 */
async function reassignPrimaryAfterRemoval(
  tx: Tx,
  ctx: Parameters<typeof syncOpportunityAmount>[1],
  opportunityId: string,
  removedQuotationId: string
): Promise<void> {
  const [opp] = await tx
    .select({ primaryQuotationId: opportunities.primaryQuotationId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1)
  if (opp?.primaryQuotationId !== removedQuotationId) return

  const [candidate] = await tx
    .select({ id: quotations.id })
    .from(quotations)
    .where(
      and(
        eq(quotations.opportunityId, opportunityId),
        ne(quotations.id, removedQuotationId),
        isNull(quotations.deletedAt),
        notInArray(quotations.status, ["rejected", "expired", "void"])
      )
    )
    .orderBy(desc(quotations.createdAt))
    .limit(1)

  if (candidate) {
    await tx
      .update(quotations)
      .set({ isPrimary: false })
      .where(
        and(
          eq(quotations.opportunityId, opportunityId),
          ne(quotations.id, candidate.id)
        )
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true })
      .where(eq(quotations.id, candidate.id))
    await tx
      .update(opportunities)
      .set({ primaryQuotationId: candidate.id, updatedAt: new Date() })
      .where(eq(opportunities.id, opportunityId))
  } else {
    // No live quote remains: clear the pointer AND reset the amount. Without
    // this, syncOpportunityAmount short-circuits on the null pointer and the
    // opportunity keeps reporting the removed quote's net in the forecast.
    await tx
      .update(opportunities)
      .set({ primaryQuotationId: null, amount: null, updatedAt: new Date() })
      .where(eq(opportunities.id, opportunityId))
  }
  await syncOpportunityAmount(tx, ctx, opportunityId)
}

/** Result of {@link setPrimaryQuotation}: the prior primary quote id (if any),
 *  so the client can offer an Undo that restores it. */
export type SetPrimaryResult = { previousPrimaryId: string | null }

export async function setPrimaryQuotation(
  id: string
): Promise<ActionResult<SetPrimaryResult>> {
  return runAction(async () => {
  const out = await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!q) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        ownerMemberId: opportunities.ownerMemberId,
        primaryQuotationId: opportunities.primaryQuotationId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    // Capture the prior primary so the caller can offer an Undo (it changes the
    // funnel's reported value/forecast, so a reversible affordance matters).
    const previousPrimaryId =
      opp?.primaryQuotationId && opp.primaryQuotationId !== id
        ? opp.primaryQuotationId
        : null
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
    return { previousPrimaryId }
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  return out
  })
}

export async function deleteQuotation(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.QUOTATION_DELETE, async (tx, ctx) => {
    const [existing] = await tx
      .select({
        opportunityId: quotations.opportunityId,
        status: quotations.status,
        oppOwner: opportunities.ownerMemberId,
      })
      .from(quotations)
      .leftJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.oppOwner))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    // An accepted quote is the basis for a won deal / project / sales order;
    // soft-delete doesn't fire the FK set-null, so deleting it would dangle
    // those references and corrupt the deal's historical value.
    if (existing.status === "accepted")
      throw new Error(
        "An accepted quotation can't be deleted. Create a revision instead."
      )
    // Refuse if a live project was built from this quotation.
    const [linkedProject] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.quotationId, id), isNull(projects.deletedAt)))
      .limit(1)
    if (linkedProject)
      throw new Error(
        "This quotation can't be deleted because a project references it."
      )
    const [updated] = await tx
      .update(quotations)
      .set({ deletedAt: new Date(), isPrimary: false, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) throw new Error("Quotation not found")
    // If this was the opportunity's primary, promote another live quote (or
    // clear the pointer) and re-sync so a deleted quote stops driving value.
    await reassignPrimaryAfterRemoval(tx, ctx, existing.opportunityId, id)
    await writeAudit(tx, ctx, {
      action: "quotation.deleted",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  })
}
