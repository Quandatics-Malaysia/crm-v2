"use server"

import { and, asc, desc, eq, isNull, ne, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, requireContext, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { quotationsList, quotationsGet } from "@/lib/api-readers"
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
  funnels,
  opportunityProducts,
  projects,
  taxSettings,
  tenantSettings,
  products,
  accounts,
  persons,
  organization,
  member,
  user,
} from "@/db/schema"
import type { ProductOption } from "@/lib/lookups"
import { computeQuotation } from "@/server/services/quotation-math"
import { syncOpportunityAmount, quoteNet } from "@/server/services/value"
import { syncFunnelProductsFromQuote } from "@/server/services/quote-sync"
import { winOpportunity } from "@/server/services/stage"
import { nextQuoteNumber } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { writeAudit } from "@/server/audit"
import { seedDefaultFunnelMilestone } from "@/app/(app)/payment-milestones/actions"
import { toDateString } from "@/lib/dates"
import { getEntitledModuleMap } from "@/lib/modules.server"

export type QuotationRow = typeof quotations.$inferSelect
export type QuotationLineRow = typeof quotationLineItems.$inferSelect

export type QuotationListItem = QuotationRow & {
  opportunityName: string | null
  lineItemCount: number
}

export type LineInput = {
  productId?: string | null
  /** Project-nature code this line bills under (per-nature revenue split). */
  projectNatureCode?: string | null
  uom?: string | null
  description: string
  quantity: string
  unitPrice: string
  discountAmount: string
}

export type QuotationHeaderInput = {
  taxSettingId: string | null
  validUntil: string | null
  notes: string | null
  headerDiscount?: string | null
  /** Tenant project-nature code (tenant_settings.product_types[].code), editable. */
  projectNatureCode?: string | null
  lines: LineInput[]
}

export type QuotationDetail = {
  quotation: QuotationRow
  lines: QuotationLineRow[]
  opportunityName: string | null
  /** Parent Opportunity container of the quotation's funnel. */
  container: { id: string; name: string } | null
  accountId: string | null
  accountName: string | null
}

/** Largest page returned by the list action (mirrors the original inline .limit(500)). */
const LIST_LIMIT = 500

/** All non-deleted quotations with their opportunity name, newest first. */
export async function listQuotations(): Promise<QuotationListItem[]> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const { rows } = await quotationsList(tx, ctx, { limit: LIST_LIMIT, offset: 0 })
    return rows
  })
}

export async function getQuotation(id: string): Promise<QuotationDetail | null> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, (tx, ctx) => quotationsGet(tx, ctx, id))
}

export type QuotationDocument = {
  quotation: QuotationRow
  lines: Array<QuotationLineRow & { sku: string | null }>
  entityName: string
  entityCode: string | null
  entitySlug: string
  projectName: string
  preparedBy: { name: string; email: string | null } | null
  /** Seller-entity identifier retained for preview compatibility. */
  pdfTemplateKey: string | null
  /** Company profile from Settings — the sender block, bank details, footer. */
  company: {
    address: string | null
    registrationNo: string | null
    phone: string | null
    email: string | null
    website: string | null
    bankDetails: string | null
    quoteFooter: string | null
    hasLogo: boolean
  }
  account: {
    name: string
    code: string | null
    phone: string | null
    address: {
      line1?: string | null
      line2?: string | null
      city?: string | null
      state?: string | null
      postcode?: string | null
      country?: string | null
    } | null
  } | null
  contact: { name: string; email: string | null; phone: string | null } | null
}

/**
 * Everything needed to render the printable quotation document: the quote +
 * lines, the billing account (name/address/phone) and its primary contact, and
 * the tenant/entity name for the letterhead.
 */
export async function getQuotationDocument(
  id: string
): Promise<QuotationDocument | null> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [row] = await tx
      .select({
        q: quotations,
        oppOwner: funnels.ownerMemberId,
        accountId: funnels.accountId,
        projectName: funnels.name,
        preparedByName: user.name,
        preparedByEmail: user.email,
      })
      .from(quotations)
      .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
      .leftJoin(member, eq(funnels.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
    if (!row) return null
    if (!ownsOrManages(visible, row.oppOwner)) return null

    const lines = await tx
      .select({
        line: quotationLineItems,
        sku: products.productCode,
      })
      .from(quotationLineItems)
      .leftJoin(products, eq(quotationLineItems.productId, products.id))
      .where(eq(quotationLineItems.quotationId, id))
      .orderBy(asc(quotationLineItems.sortOrder))
      .then((rows) => rows.map(({ line, sku }) => ({ ...line, sku })))

    let account: QuotationDocument["account"] = null
    let contact: QuotationDocument["contact"] = null
    if (row.accountId) {
      const [accountWithType] = await tx
        .select({
          name: accounts.name,
          code: accounts.code,
          phone: accounts.phone,
          billingAddress: accounts.billingAddress,
          accountType: accounts.accountType,
          endUserAccountId: accounts.endUserAccountId,
        })
        .from(accounts)
        .where(eq(accounts.id, row.accountId))
        .limit(1)

      const attentionAccountId =
        accountWithType?.accountType === "reseller" &&
        accountWithType?.endUserAccountId
          ? accountWithType.endUserAccountId
          : row.accountId

      if (accountWithType) {
        account = {
          name: accountWithType.name,
          code: accountWithType.code,
          phone: accountWithType.phone,
          address:
            (accountWithType.billingAddress as NonNullable<
              QuotationDocument["account"]
            >["address"]) ?? null,
        }
      }

      const [primary] = await tx
        .select({
          firstName: persons.firstName,
          lastName: persons.lastName,
          email: persons.email,
          phone: persons.phone,
        })
        .from(persons)
        .where(
          and(
            eq(persons.accountId, attentionAccountId),
            eq(persons.isPrimary, true),
            isNull(persons.deletedAt)
          )
        )
        .limit(1)
      if (primary) {
        contact = {
          name: [primary.firstName, primary.lastName].filter(Boolean).join(" "),
          email: primary.email,
          phone: primary.phone,
        }
      }
    }

    const [org] = await tx
      .select({ name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, ctx.tenantId))
      .limit(1)

    const [profile] = await tx
      .select({
        address: tenantSettings.companyAddress,
        registrationNo: tenantSettings.companyRegistrationNo,
        phone: tenantSettings.companyPhone,
        email: tenantSettings.companyEmail,
        website: tenantSettings.companyWebsite,
        bankDetails: tenantSettings.bankDetails,
        quoteFooter: tenantSettings.quoteFooter,
        logoStorageKey: tenantSettings.logoStorageKey,
        entityCode: tenantSettings.entityCode,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    return {
      quotation: row.q,
      lines,
      entityName: org?.name ?? "Quotation",
      entityCode: profile?.entityCode ?? null,
      entitySlug: org?.slug ?? "",
      projectName: row.projectName ?? "",
      preparedBy:
        row.preparedByName || row.preparedByEmail
          ? { name: row.preparedByName ?? "", email: row.preparedByEmail }
          : null,
      pdfTemplateKey: profile?.entityCode ?? org?.slug ?? null,
      company: {
        address: profile?.address ?? null,
        registrationNo: profile?.registrationNo ?? null,
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
        website: profile?.website ?? null,
        bankDetails: profile?.bankDetails ?? null,
        quoteFooter: profile?.quoteFooter ?? null,
        hasLogo: !!profile?.logoStorageKey,
      },
      account,
      contact,
    }
  })
}

/**
 * The delivery project created from this quotation, if any.
 * Used on the detail page to cross-link to /projects/<id>.
 */
export async function getProjectForQuotation(
  quotationId: string
): Promise<{ id: string; projectCode: string; name: string } | null> {
  if (!(await getEntitledModuleMap()).projects) return null
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [scope] = await tx
      .select({ oppOwner: funnels.ownerMemberId })
      .from(quotations)
      .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
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

/** Open funnels for the "new quotation" picker. */
export async function listOpportunityOptions(): Promise<
  { id: string; name: string }[]
> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({ id: funnels.id, name: funnels.name })
      .from(funnels)
      .where(
        and(
          isNull(funnels.deletedAt),
          ownerScope(funnels.ownerMemberId, visible)
        )
      )
      .orderBy(asc(funnels.name))
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
  projectNatures: { code: string; name: string }[]
  products: ProductOption[]
  /** Prefill for "Valid until" (today + tenant quote_valid_days), or null. */
  defaultValidUntil: string | null
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
    const [settings] = await tx
      .select({
        projectNatures: tenantSettings.projectNatures,
        quoteValidDays: tenantSettings.quoteValidDays,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    let defaultValidUntil: string | null = null
    if (settings?.quoteValidDays) {
      const d = new Date()
      d.setDate(d.getDate() + settings.quoteValidDays)
      defaultValidUntil = toDateString(d)
    }
    const productOptions = await tx
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        standardPrice: products.standardPrice,
        currency: products.currency,
        uom: products.uom,
      })
      .from(products)
      .where(and(eq(products.isActive, true), isNull(products.deletedAt)))
      .orderBy(asc(products.name))
    return {
      taxOptions,
      taxInclusive,
      projectNatures: settings?.projectNatures ?? [],
      products: productOptions,
      defaultValidUntil,
    }
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
  funnelId: string
  taxSettingId: string | null
  validUntil: string | null
  notes: string | null
  headerDiscount?: string | null
  /** Optional override; defaults to the funnel's project nature when omitted. */
  projectNatureCode?: string | null
  lines: LineInput[]
}): Promise<ActionResult<QuotationRow>> {
  return runAction(async () => {
  const row = await withTenant(PERMISSIONS.QUOTATION_CREATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        id: funnels.id,
        currency: funnels.currency,
        primaryQuotationId: funnels.primaryQuotationId,
        ownerMemberId: funnels.ownerMemberId,
        projectNatureCode: funnels.projectNatureCode,
      })
      .from(funnels)
      .where(and(eq(funnels.id, input.funnelId), isNull(funnels.deletedAt)))
      .limit(1)
    if (!opp) throw new Error("Funnel not found")
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp.ownerMemberId))
      throw new Error("FORBIDDEN")

    // Inherit the funnel's project nature as the default when the user didn't
    // pick one; the quotation keeps it editable from here on.
    const projectNatureCode =
      (input.projectNatureCode?.trim() || null) ?? opp.projectNatureCode ?? null

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
        discountAmount: l.discountAmount,
      })),
      ratePercent: ratePercent ?? 0,
      headerDiscount: input.headerDiscount ?? 0,
      taxInclusive,
    })

    const { quoteNumber, version } = await nextQuoteNumber(tx, ctx, input.funnelId)

    const [created] = await tx
      .insert(quotations)
      .values({
        tenantId: ctx.tenantId,
        funnelId: input.funnelId,
        quoteNumber,
        version,
        status: "draft",
        currency: opp.currency,
        projectNatureCode,
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
        .update(funnels)
        .set({ primaryQuotationId: created.id, updatedAt: new Date() })
        .where(eq(funnels.id, input.funnelId))
      await syncOpportunityAmount(tx, ctx, input.funnelId)
      // Synced quote -> opportunity products (Salesforce Quote Line Item ->
      // Opportunity Product behaviour).
      await syncFunnelProductsFromQuote(tx, ctx.tenantId, input.funnelId, created.id)
      // Itemised into the quotation by default: a synced quote seeds exactly
      // one "Full Payment" milestone, no-op once any milestone exists.
      await seedDefaultFunnelMilestone(tx, ctx, input.funnelId)
    }

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: input.funnelId,
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
      .select({ ownerMemberId: funnels.ownerMemberId })
      .from(funnels)
      .where(eq(funnels.id, existing.funnelId))
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
        discountAmount: l.discountAmount,
      })),
      ratePercent: ratePercent ?? 0,
      headerDiscount,
      taxInclusive,
    })

    const [updated] = await tx
      .update(quotations)
      .set({
        taxSettingId: input.taxSettingId,
        projectNatureCode: input.projectNatureCode?.trim() || null,
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

    // If this quote is the opportunity's primary, keep amount == its net, and
    // keep opportunity products in step with the lines just replaced.
    if (existing.isPrimary) {
      await syncOpportunityAmount(tx, ctx, existing.funnelId)
      await syncFunnelProductsFromQuote(tx, ctx.tenantId, existing.funnelId, id)
      // Covers the common case of a quote auto-promoted to primary while
      // still $0 (a brand-new draft), then given real value here — the
      // "becomes primary" seed call already fired at net value 0 and no-op'd.
      await seedDefaultFunnelMilestone(tx, ctx, existing.funnelId)
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
      productId: l.productId?.trim() || null,
      projectNatureCode: l.projectNatureCode?.trim() || null,
      uom: l.uom?.trim() || null,
      description: l.description,
      quantity: l.quantity || "0",
      unitPrice: l.unitPrice || "0",
      discountAmount: l.discountAmount || "0",
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
        ownerMemberId: funnels.ownerMemberId,
        status: funnels.status,
      })
      .from(funnels)
      .where(eq(funnels.id, q.funnelId))
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
        discountAmount: l.discountAmount,
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
      await syncOpportunityAmount(tx, ctx, q.funnelId)
    }

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: q.funnelId,
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
  funnelId: string
  accountId: string
  /** Non-fatal warning when accept committed but the auto-win move failed. */
  warning?: string
  /**
   * True when auto-win was enabled but winning the funnel is gated behind an
   * approval request (the stage did NOT move yet). The UI uses this to say the
   * win is pending approval rather than presenting the deal as won.
   */
  pendingApproval?: boolean
  /** Set when auto-create-project is on and the delivery project was created. */
  projectCreated?: { id: string; projectCode: string }
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
        ownerMemberId: funnels.ownerMemberId,
        status: funnels.status,
        accountId: funnels.accountId,
      })
      .from(funnels)
      .where(eq(funnels.id, q.funnelId))
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
          eq(quotations.funnelId, q.funnelId),
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
        and(eq(quotations.funnelId, q.funnelId), ne(quotations.id, id))
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true })
      .where(eq(quotations.id, id))

    // Set primary then derive amount from the primary quote's net.
    await tx
      .update(funnels)
      .set({ primaryQuotationId: id, updatedAt: new Date() })
      .where(eq(funnels.id, q.funnelId))
    await syncOpportunityAmount(tx, ctx, q.funnelId)
    // Synced quote -> opportunity products (Salesforce Quote Line Item ->
    // Opportunity Product behaviour).
    await syncFunnelProductsFromQuote(tx, ctx.tenantId, q.funnelId, id)
    // Itemised into the quotation by default: a synced quote seeds exactly
    // one "Full Payment" milestone, no-op once any milestone exists.
    await seedDefaultFunnelMilestone(tx, ctx, q.funnelId)

    const [settings] = await tx
      .select({
        autoWin: tenantSettings.autoWinOnQuoteAccept,
        autoProject: tenantSettings.autoCreateProjectOnAccept,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    await logActivity(tx, ctx, {
      entityType: "opportunity",
      entityId: q.funnelId,
      type: "system",
      subject: `Quotation ${q.quoteNumber} accepted`,
    })

    await writeAudit(tx, ctx, {
      action: "quotation.accepted",
      entityType: "quotation",
      entityId: id,
      after: { funnelId: q.funnelId, amount: quoteNet(q) },
    })

    return {
      funnelId: q.funnelId,
      accountId: opp.accountId,
      autoWin: settings?.autoWin ?? false,
      autoProject: settings?.autoProject ?? false,
      quotationId: id,
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
      const winResult = (await winOpportunity(ctx, result.funnelId)) as
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

  // Automation: auto-create the delivery project (Settings → Behavior). Runs
  // AFTER acceptance committed and is strictly best-effort — a failure (no
  // account code yet, missing permission, duplicate code race) surfaces as a
  // warning, never as a failed acceptance.
  let projectCreated: AcceptQuotationResult["projectCreated"]
  if (result.autoProject && (await getEntitledModuleMap()).projects) {
    try {
      // Loaded lazily so core quotations carries no static dependency on the
      // projects plugin (whose actions transitively import sales-orders +
      // finance).
      const { createProject, prefillFromOpportunity } = await import(
        "@/app/(app)/projects/actions"
      )
      const ctx = await requireContext()
      if (!ctx.can(PERMISSIONS.PROJECT_CREATE)) {
        throw new Error("you don't have the Create projects permission")
      }
      // Skip when a project already exists for this quotation.
      const existing = await withTenant(
        PERMISSIONS.PROJECT_CREATE,
        async (tx) => {
          const [p] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.quotationId, result.quotationId),
                isNull(projects.deletedAt)
              )
            )
            .limit(1)
          return p ?? null
        }
      )
      if (!existing) {
        const prefill = await prefillFromOpportunity(result.funnelId)
        if (!prefill) throw new Error("the funnel could not be loaded")
        const created = await createProject({
          name: prefill.opportunityName,
          accountId: prefill.accountId,
          funnelId: result.funnelId,
          quotationId: prefill.quotationId ?? result.quotationId,
          value: prefill.value,
          currency: prefill.currency,
          projectNatureCode: prefill.projectNatureCode || undefined,
        })
        if (!created.ok) throw new Error(created.error)
        projectCreated = created.data
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unknown error"
      const note = `Quotation accepted, but the project was not auto-created (${detail}). Create it from the funnel when ready.`
      warning = warning ? `${warning} ${note}` : note
    }
  }

  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  return {
    funnelId: result.funnelId,
    accountId: result.accountId,
    warning,
    pendingApproval,
    projectCreated,
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
      .select({ ownerMemberId: funnels.ownerMemberId })
      .from(funnels)
      .where(eq(funnels.id, q.funnelId))
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
    await reassignPrimaryAfterRemoval(tx, ctx, q.funnelId, id)
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
  funnelId: string,
  removedQuotationId: string
): Promise<void> {
  const [opp] = await tx
    .select({ primaryQuotationId: funnels.primaryQuotationId })
    .from(funnels)
    .where(eq(funnels.id, funnelId))
    .limit(1)
  if (opp?.primaryQuotationId !== removedQuotationId) return

  const [candidate] = await tx
    .select({ id: quotations.id })
    .from(quotations)
    .where(
      and(
        eq(quotations.funnelId, funnelId),
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
          eq(quotations.funnelId, funnelId),
          ne(quotations.id, candidate.id)
        )
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true })
      .where(eq(quotations.id, candidate.id))
    await tx
      .update(funnels)
      .set({ primaryQuotationId: candidate.id, updatedAt: new Date() })
      .where(eq(funnels.id, funnelId))
    // Synced quote -> opportunity products (Salesforce Quote Line Item ->
    // Opportunity Product behaviour).
    await syncFunnelProductsFromQuote(tx, ctx.tenantId, funnelId, candidate.id)
    await seedDefaultFunnelMilestone(tx, ctx, funnelId)
  } else {
    // No live quote remains: clear the pointer AND reset the amount. Without
    // this, syncOpportunityAmount short-circuits on the null pointer and the
    // opportunity keeps reporting the removed quote's net in the forecast.
    await tx
      .update(funnels)
      .set({ primaryQuotationId: null, amount: null, updatedAt: new Date() })
      .where(eq(funnels.id, funnelId))
    // No synced quote left to drive opportunity products either.
    await tx
      .delete(opportunityProducts)
      .where(
        and(
          eq(opportunityProducts.tenantId, ctx.tenantId),
          eq(opportunityProducts.funnelId, funnelId)
        )
      )
  }
  await syncOpportunityAmount(tx, ctx, funnelId)
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
        ownerMemberId: funnels.ownerMemberId,
        primaryQuotationId: funnels.primaryQuotationId,
      })
      .from(funnels)
      .where(eq(funnels.id, q.funnelId))
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
        and(eq(quotations.funnelId, q.funnelId), ne(quotations.id, id))
      )
    await tx
      .update(quotations)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(quotations.id, id))
    await tx
      .update(funnels)
      .set({ primaryQuotationId: id, updatedAt: new Date() })
      .where(eq(funnels.id, q.funnelId))
    await syncOpportunityAmount(tx, ctx, q.funnelId)
    // Synced quote -> opportunity products (Salesforce Quote Line Item ->
    // Opportunity Product behaviour).
    await syncFunnelProductsFromQuote(tx, ctx.tenantId, q.funnelId, id)
    // Itemised into the quotation by default: a synced quote seeds exactly
    // one "Full Payment" milestone, no-op once any milestone exists.
    await seedDefaultFunnelMilestone(tx, ctx, q.funnelId)
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
        funnelId: quotations.funnelId,
        status: quotations.status,
        oppOwner: funnels.ownerMemberId,
      })
      .from(quotations)
      .leftJoin(funnels, eq(quotations.funnelId, funnels.id))
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
    // Retained rows outlive module ownership. Always protect their references.
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
    await reassignPrimaryAfterRemoval(tx, ctx, existing.funnelId, id)
    await writeAudit(tx, ctx, {
      action: "quotation.deleted",
      entityType: "quotation",
      entityId: id,
    })
  })
  revalidatePath("/quotations")
  })
}
