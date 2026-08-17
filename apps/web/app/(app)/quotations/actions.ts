"use server"

import { and, asc, desc, eq, isNull, ne, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, type Tx } from "@/lib/actions"
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
import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"
import { tenantCurrencyForRecord } from "@/server/services/tenant-currency"
import { computeQuotation } from "@/server/services/quotation-math"
import { syncOpportunityAmount, quoteNet } from "@/server/services/value"
import { syncFunnelProductsFromQuote } from "@/server/services/quote-sync"
import { nextQuoteNumber } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { writeAudit } from "@/server/audit"
import { seedDefaultFunnelMilestone } from "@/app/(app)/payment-milestones/actions"
import { toDateString } from "@/lib/dates"
import { getEntitledModuleMap } from "@/lib/modules.server"
import {
  getActiveQuotationTemplateByCode,
  listActiveQuotationTemplateCodes,
  type QuotationTemplateSpec,
} from "@/lib/quotation-template-registry"
import { resolveQuotationPdfTemplate } from "@/lib/quotation-pdf-template"
import {
  assertAttentionContactBelongsToAccount,
  attentionContactChanged,
  quotationContentAuditSnapshot,
  resolveQuotationContent,
} from "@/lib/quotation-content"
import {
  assertApprovalRejectionReason,
  assertQuotationTransition,
} from "@/lib/quotation-transitions"
import { canCreateQuotationRevision } from "@/lib/quotation-revision-policy"

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
  currency?: string | null
  taxSettingId: string | null
  validUntil: string | null
  notes: string | null
  delivery?: string | null
  paymentTerm?: string | null
  attentionContactId?: string | null
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
  /** Optional account-level template override, resolved before entity identity. */
  accountQuotationTemplateCode: string | null
  /** Final active template selected for this quotation. */
  resolvedTemplateCode: string
  /** Registry entry used by the external HTML renderer, when configured. */
  quotationTemplate: QuotationTemplateSpec | null
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
    let accountQuotationTemplateCode: string | null = null
    if (row.accountId) {
      const [accountWithType] = await tx
        .select({
          name: accounts.name,
          code: accounts.code,
          phone: accounts.phone,
          billingAddress: accounts.billingAddress,
          accountType: accounts.accountType,
          endUserAccountId: accounts.endUserAccountId,
          quotationTemplateCode: accounts.quotationTemplateCode,
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
        accountQuotationTemplateCode = accountWithType.quotationTemplateCode
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

      const [savedContact] = row.q.attentionContactId
        ? await tx
            .select({
              accountId: persons.accountId,
              firstName: persons.firstName,
              lastName: persons.lastName,
              email: persons.email,
              phone: persons.phone,
            })
            .from(persons)
            .where(
              and(
                eq(persons.id, row.q.attentionContactId),
                eq(persons.tenantId, ctx.tenantId),
                isNull(persons.deletedAt)
              )
            )
            .limit(1)
        : []
      if (savedContact) {
        let belongsToRecipient = true
        try {
          assertAttentionContactBelongsToAccount(
            savedContact.accountId,
            attentionAccountId
          )
        } catch {
          belongsToRecipient = false
        }
        if (belongsToRecipient) {
          contact = {
            name: [savedContact.firstName, savedContact.lastName]
              .filter(Boolean)
              .join(" "),
            email: savedContact.email,
            phone: savedContact.phone,
          }
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
        quotationTemplateCode: tenantSettings.quotationTemplateCode,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    const activeTemplateCodes = await listActiveQuotationTemplateCodes(tx, ctx.tenantId)
    const resolvedTemplateCode = resolveQuotationPdfTemplate({
      accountTemplateCode: accountQuotationTemplateCode,
      rawTemplateCode: profile?.quotationTemplateCode ?? null,
      legacyKey: profile?.entityCode ?? org?.slug ?? null,
      entityCode: profile?.entityCode ?? null,
      entitySlug: org?.slug ?? null,
      entityName: org?.name ?? null,
      allowedCodes: activeTemplateCodes,
    })
    const quotationTemplate = await getActiveQuotationTemplateByCode(
      tx,
      ctx.tenantId,
      resolvedTemplateCode
    )

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
      accountQuotationTemplateCode,
      resolvedTemplateCode,
      quotationTemplate,
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
  { id: string; name: string; currency: string }[]
> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({ id: funnels.id, name: funnels.name, currency: funnels.currency })
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

export type QuotationContactOption = {
  id: string
  name: string
  email: string | null
  phone: string | null
  isPrimary: boolean
}

/**
 * Tax settings + tenant tax-inclusive flag needed to render and live-preview a
 * quotation create form. Fetched on demand by the embeddable create dialog so
 * it can stand alone wherever it is triggered.
 */
export async function getQuotationFormMeta(funnelId?: string | null): Promise<{
  taxOptions: TaxOption[]
  taxInclusive: boolean
  projectNatures: { code: string; name: string }[]
  products: ProductOption[]
  /** Prefill for "Valid until" (today + tenant quote_valid_days), or null. */
  defaultValidUntil: string | null
  currencies: string[]
  contacts: QuotationContactOption[]
  defaultAttentionContactId: string | null
  quoteDefaults: {
    notes: string | null
    delivery: string | null
    paymentTerm: string | null
  }
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
        currencies: tenantSettings.currencies,
        quoteDefaultNotes: tenantSettings.quoteDefaultNotes,
        quoteDefaultDelivery: tenantSettings.quoteDefaultDelivery,
        quoteDefaultPaymentTerm: tenantSettings.quoteDefaultPaymentTerm,
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
    let contacts: QuotationContactOption[] = []
    if (funnelId) {
      const visible = await visibleMemberIds(tx, ctx)
      const [funnel] = await tx
        .select({ ownerMemberId: funnels.ownerMemberId, accountId: funnels.accountId })
        .from(funnels)
        .where(
          and(
            eq(funnels.id, funnelId),
            eq(funnels.tenantId, ctx.tenantId),
            isNull(funnels.deletedAt)
          )
        )
        .limit(1)
      if (!funnel || (!canManageAllRecords(ctx) && !ownsOrManages(visible, funnel.ownerMemberId))) {
        throw new Error("Funnel not found")
      }
      let recipientAccountId = funnel.accountId
      if (recipientAccountId) {
        const [account] = await tx
          .select({ accountType: accounts.accountType, endUserAccountId: accounts.endUserAccountId })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, recipientAccountId),
              eq(accounts.tenantId, ctx.tenantId),
              isNull(accounts.deletedAt)
            )
          )
          .limit(1)
        if (account?.accountType === "reseller" && account.endUserAccountId) {
          recipientAccountId = account.endUserAccountId
        }
      }
      if (recipientAccountId) {
        contacts = await tx
          .select({
            id: persons.id,
            firstName: persons.firstName,
            lastName: persons.lastName,
            email: persons.email,
            phone: persons.phone,
            isPrimary: persons.isPrimary,
          })
          .from(persons)
          .where(
            and(
              eq(persons.tenantId, ctx.tenantId),
              eq(persons.accountId, recipientAccountId),
              isNull(persons.deletedAt)
            )
          )
          .orderBy(desc(persons.isPrimary), asc(persons.firstName), asc(persons.lastName))
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              name: [row.firstName, row.lastName].filter(Boolean).join(" "),
              email: row.email,
              phone: row.phone,
              isPrimary: row.isPrimary,
            }))
          )
      }
    }
    return {
      taxOptions,
      taxInclusive,
      projectNatures: settings?.projectNatures ?? [],
      products: productOptions,
      defaultValidUntil,
      currencies: settings?.currencies?.length ? settings.currencies : DEFAULT_CURRENCIES,
      contacts,
      defaultAttentionContactId: contacts.find((contact) => contact.isPrimary)?.id ?? null,
      quoteDefaults: {
        notes: settings?.quoteDefaultNotes ?? null,
        delivery: settings?.quoteDefaultDelivery ?? null,
        paymentTerm: settings?.quoteDefaultPaymentTerm ?? null,
      },
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
  currency?: string | null
  taxSettingId: string | null
  validUntil: string | null
  notes?: string | null
  delivery?: string | null
  paymentTerm?: string | null
  attentionContactId?: string | null
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
        accountId: funnels.accountId,
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

    const currency = await tenantCurrencyForRecord(
      tx,
      ctx.tenantId,
      input.currency,
      opp.currency,
    )

    let recipientAccountId = opp.accountId
    if (recipientAccountId) {
      const [account] = await tx
        .select({
          accountType: accounts.accountType,
          endUserAccountId: accounts.endUserAccountId,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.id, recipientAccountId),
            eq(accounts.tenantId, ctx.tenantId),
            isNull(accounts.deletedAt)
          )
        )
        .limit(1)
      if (account?.accountType === "reseller" && account.endUserAccountId) {
        recipientAccountId = account.endUserAccountId
      }
    }

    let attentionContactId: string | null = input.attentionContactId ?? null
    if (input.attentionContactId === undefined && recipientAccountId) {
      const [primary] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.tenantId, ctx.tenantId),
            eq(persons.accountId, recipientAccountId),
            eq(persons.isPrimary, true),
            isNull(persons.deletedAt)
          )
        )
        .limit(1)
      attentionContactId = primary?.id ?? null
    }
    if (attentionContactId) {
      const [contact] = await tx
        .select({ accountId: persons.accountId })
        .from(persons)
        .where(
          and(
            eq(persons.id, attentionContactId),
            eq(persons.tenantId, ctx.tenantId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1)
      if (!contact) throw new Error("Attention contact not found")
      assertAttentionContactBelongsToAccount(contact.accountId, recipientAccountId)
    }

    const [settings] = await tx
      .select({
        quoteDefaultNotes: tenantSettings.quoteDefaultNotes,
        quoteDefaultDelivery: tenantSettings.quoteDefaultDelivery,
        quoteDefaultPaymentTerm: tenantSettings.quoteDefaultPaymentTerm,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    const content = resolveQuotationContent(input, {
      notes: settings?.quoteDefaultNotes ?? null,
      delivery: settings?.quoteDefaultDelivery ?? null,
      paymentTerm: settings?.quoteDefaultPaymentTerm ?? null,
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
        currency,
        projectNatureCode,
        taxSettingId: input.taxSettingId,
        taxInclusive,
        subtotal: totals.subtotal.toFixed(2),
        headerDiscount: (Number(input.headerDiscount ?? 0) || 0).toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        taxTotal: totals.taxTotal.toFixed(2),
        total: totals.total.toFixed(2),
        validUntil: input.validUntil || null,
        notes: content.notes,
        delivery: content.delivery,
        paymentTerm: content.paymentTerm,
        attentionContactId,
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
      after: quotationContentAuditSnapshot(created),
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
      .for("update")
    if (!existing) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        ownerMemberId: funnels.ownerMemberId,
        currency: funnels.currency,
        accountId: funnels.accountId,
      })
      .from(funnels)
      .where(eq(funnels.id, existing.funnelId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    if (existing.status !== "draft")
      throw new Error("Only draft quotations can be edited")
    const resolvedCurrency = await tenantCurrencyForRecord(
      tx,
      ctx.tenantId,
      input.currency,
      existing.currency
    )

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

    let attentionContactId = existing.attentionContactId
    if (input.attentionContactId !== undefined) {
      attentionContactId = input.attentionContactId
      if (
        attentionContactId &&
        attentionContactChanged(existing.attentionContactId, attentionContactId)
      ) {
        const [contact] = await tx
          .select({ accountId: persons.accountId })
          .from(persons)
          .where(
            and(
              eq(persons.id, attentionContactId),
              eq(persons.tenantId, ctx.tenantId),
              isNull(persons.deletedAt)
            )
          )
          .limit(1)
        if (!contact) throw new Error("Attention contact not found")

        let recipientAccountId = opp?.accountId ?? null
        if (recipientAccountId) {
          const [account] = await tx
            .select({
              accountType: accounts.accountType,
              endUserAccountId: accounts.endUserAccountId,
            })
            .from(accounts)
            .where(
              and(
                eq(accounts.id, recipientAccountId),
                eq(accounts.tenantId, ctx.tenantId),
                isNull(accounts.deletedAt)
              )
            )
            .limit(1)
          if (account?.accountType === "reseller" && account.endUserAccountId) {
            recipientAccountId = account.endUserAccountId
          }
        }
        assertAttentionContactBelongsToAccount(contact.accountId, recipientAccountId)
      }
    }
    const content = resolveQuotationContent(input, {
      notes: existing.notes,
      delivery: existing.delivery,
      paymentTerm: existing.paymentTerm,
    })

    const [updated] = await tx
      .update(quotations)
      .set({
        currency: resolvedCurrency,
        taxSettingId: input.taxSettingId,
        projectNatureCode: input.projectNatureCode?.trim() || null,
        subtotal: totals.subtotal.toFixed(2),
        headerDiscount: headerDiscount.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        taxTotal: totals.taxTotal.toFixed(2),
        total: totals.total.toFixed(2),
        validUntil: input.validUntil || null,
        notes: content.notes,
        delivery: content.delivery,
        paymentTerm: content.paymentTerm,
        attentionContactId,
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
      before: quotationContentAuditSnapshot({
        attentionContactId: existing.attentionContactId,
        notes: existing.notes,
        delivery: existing.delivery,
        paymentTerm: existing.paymentTerm,
      }),
      after: quotationContentAuditSnapshot({
        attentionContactId,
        notes: content.notes,
        delivery: content.delivery,
        paymentTerm: content.paymentTerm,
      }),
    })
    return updated
  })
  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  revalidatePath(`/quotations/${id}/preview`)
  return row
  })
}

async function getLockedQuotation(tx: Tx, id: string): Promise<QuotationRow> {
  const [quotation] = await tx
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
    .limit(1)
    .for("update")
  if (!quotation) throw new Error("Quotation not found")
  return quotation
}

async function assertQuotationAccess(
  tx: Tx,
  ctx: Parameters<typeof visibleMemberIds>[1],
  quotation: QuotationRow
): Promise<void> {
  const visible = await visibleMemberIds(tx, ctx)
  const [funnel] = await tx
    .select({ ownerMemberId: funnels.ownerMemberId })
    .from(funnels)
    .where(eq(funnels.id, quotation.funnelId))
    .limit(1)
  if (!canManageAllRecords(ctx) && !ownsOrManages(visible, funnel?.ownerMemberId ?? null)) {
    throw new Error("FORBIDDEN: not permitted on this quotation")
  }
}

/**
 * Clone a historical quotation into a new editable Draft. The source lookup
 * intentionally does not filter soft-deleted rows: a deleted quotation is
 * still tenant-owned history and may be revised by a user who can see it.
 */
export async function createQuotationRevision(
  sourceQuotationId: string
): Promise<ActionResult<{ id: string; quoteNumber: string }>> {
  return runAction(async () => {
    let sourceFunnelId: string | null = null
    const result = await withTenant(PERMISSIONS.QUOTATION_CREATE, async (tx, ctx) => {
      const [source] = await tx
        .select()
        .from(quotations)
        .where(
          and(
            eq(quotations.id, sourceQuotationId),
            eq(quotations.tenantId, ctx.tenantId)
          )
        )
        .limit(1)
        .for("update")
      if (!source) throw new Error("Quotation not found")
      if (!canCreateQuotationRevision(source.status, source.deletedAt)) {
        throw new Error("Only eligible non-draft quotations can be revised")
      }
      sourceFunnelId = source.funnelId

      await assertQuotationAccess(tx, ctx, source)

      const sourceLines = await tx
        .select()
        .from(quotationLineItems)
        .where(eq(quotationLineItems.quotationId, source.id))
        .orderBy(asc(quotationLineItems.sortOrder))

      const [funnel] = await tx
        .select({ accountId: funnels.accountId })
        .from(funnels)
        .where(eq(funnels.id, source.funnelId))
        .limit(1)
      let recipientAccountId = funnel?.accountId ?? null
      if (recipientAccountId) {
        const [account] = await tx
          .select({
            accountType: accounts.accountType,
            endUserAccountId: accounts.endUserAccountId,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, recipientAccountId),
              eq(accounts.tenantId, ctx.tenantId),
              isNull(accounts.deletedAt)
            )
          )
          .limit(1)
        if (account?.accountType === "reseller" && account.endUserAccountId) {
          recipientAccountId = account.endUserAccountId
        }
      }

      let attentionContactId = source.attentionContactId
      if (attentionContactId) {
        const [contact] = await tx
          .select({ accountId: persons.accountId })
          .from(persons)
          .where(
            and(
              eq(persons.id, attentionContactId),
              eq(persons.tenantId, ctx.tenantId),
              isNull(persons.deletedAt)
            )
          )
          .limit(1)
        // A removed contact cannot be copied as a live foreign-key snapshot.
        // A present contact must still belong to the current recipient.
        if (!contact) attentionContactId = null
        else assertAttentionContactBelongsToAccount(contact.accountId, recipientAccountId)
      }

      const { quoteNumber, version } = await nextQuoteNumber(
        tx,
        ctx,
        source.funnelId
      )
      const [created] = await tx
        .insert(quotations)
        .values({
          tenantId: ctx.tenantId,
          funnelId: source.funnelId,
          revisionOfId: source.id,
          quoteNumber,
          version,
          isPrimary: false,
          status: "draft",
          currency: source.currency,
          projectNatureCode: source.projectNatureCode,
          taxSettingId: source.taxSettingId,
          taxRateSnapshot: source.taxRateSnapshot,
          taxInclusive: source.taxInclusive,
          subtotal: source.subtotal,
          headerDiscount: source.headerDiscount,
          discountTotal: source.discountTotal,
          taxTotal: source.taxTotal,
          total: source.total,
          quoteDate: source.quoteDate,
          validUntil: source.validUntil,
          notes: source.notes,
          delivery: source.delivery,
          paymentTerm: source.paymentTerm,
          attentionContactId,
          approverMemberId: null,
          approvedAt: null,
          rejectionReason: null,
          sentAt: null,
          acceptedAt: null,
          deletedAt: null,
        })
        .returning({ id: quotations.id, quoteNumber: quotations.quoteNumber })
      if (!created) throw new Error("Quotation revision could not be created")

      if (sourceLines.length > 0) {
        await tx.insert(quotationLineItems).values(
          sourceLines.map((line) => ({
            tenantId: ctx.tenantId,
            quotationId: created.id,
            productId: line.productId,
            projectNatureCode: line.projectNatureCode,
            description: line.description,
            uom: line.uom,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount,
            taxSettingId: line.taxSettingId,
            lineSubtotal: line.lineSubtotal,
            lineTax: line.lineTax,
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder,
          }))
        )
      }

      await writeAudit(tx, ctx, {
        action: "quotation.revision_created",
        entityType: "quotation",
        entityId: created.id,
        before: {
          sourceQuotationId: source.id,
          sourceQuoteNumber: source.quoteNumber,
          sourceStatus: source.status,
        },
        after: {
          revisionOfId: source.id,
          quoteNumber: created.quoteNumber,
          version,
          status: "draft",
        },
      })

      return created
    })
    revalidatePath("/quotations")
    revalidatePath(`/quotations/${sourceQuotationId}`)
    if (sourceFunnelId) revalidatePath(`/funnel/${sourceFunnelId}`)
    return result
  })
}

export async function submitQuotationForApproval(
  id: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
      const quotation = await getLockedQuotation(tx, id)
      await assertQuotationAccess(tx, ctx, quotation)
      assertQuotationTransition(quotation.status, "pending_approval")

      await tx
        .update(quotations)
        .set({
          status: "pending_approval",
          approverMemberId: null,
          approvedAt: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, id))
      await writeAudit(tx, ctx, {
        action: "quotation.submitted_for_approval",
        entityType: "quotation",
        entityId: id,
        before: { status: quotation.status },
        after: { status: "pending_approval" },
      })
    })
    revalidatePath("/quotations")
    revalidatePath(`/quotations/${id}`)
  })
}

export async function approveQuotation(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.QUOTATION_APPROVE, async (tx, ctx) => {
      const quotation = await getLockedQuotation(tx, id)
      await assertQuotationAccess(tx, ctx, quotation)
      assertQuotationTransition(quotation.status, "approved")

      await tx
        .update(quotations)
        .set({
          status: "approved",
          approverMemberId: ctx.memberId,
          approvedAt: new Date(),
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, id))
      await writeAudit(tx, ctx, {
        action: "quotation.approved",
        entityType: "quotation",
        entityId: id,
        before: { status: quotation.status },
        after: { status: "approved", approverMemberId: ctx.memberId },
      })
    })
    revalidatePath("/quotations")
    revalidatePath(`/quotations/${id}`)
  })
}

/** Reject a pending approval, returning quotation to editable Draft. */
export async function rejectQuotation(
  id: string,
  reason: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.QUOTATION_APPROVE, async (tx, ctx) => {
      const quotation = await getLockedQuotation(tx, id)
      await assertQuotationAccess(tx, ctx, quotation)
      if (quotation.status !== "pending_approval") {
        throw new Error("Only pending approval quotations can be rejected")
      }
      assertQuotationTransition(quotation.status, "draft")
      const rejectionReason = assertApprovalRejectionReason(reason)

      await tx
        .update(quotations)
        .set({
          status: "draft",
          approverMemberId: null,
          approvedAt: null,
          rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, id))
      await writeAudit(tx, ctx, {
        action: "quotation.approval_rejected",
        entityType: "quotation",
        entityId: id,
        before: { status: quotation.status },
        after: { status: "draft", rejectionReason },
      })
    })
    revalidatePath("/quotations")
    revalidatePath(`/quotations/${id}`)
  })
}

export async function returnApprovedQuotationToDraft(
  id: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.QUOTATION_UPDATE, async (tx, ctx) => {
      const quotation = await getLockedQuotation(tx, id)
      await assertQuotationAccess(tx, ctx, quotation)
      if (quotation.status !== "approved") {
        throw new Error("Only approved quotations can be returned to Draft")
      }
      assertQuotationTransition(quotation.status, "draft")

      await tx
        .update(quotations)
        .set({
          status: "draft",
          approverMemberId: null,
          approvedAt: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, id))
      await writeAudit(tx, ctx, {
        action: "quotation.returned_to_draft",
        entityType: "quotation",
        entityId: id,
        before: { status: quotation.status },
        after: { status: "draft" },
      })
    })
    revalidatePath("/quotations")
    revalidatePath(`/quotations/${id}`)
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
      .for("update")
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
    assertQuotationTransition(q.status, "sent")
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
      .for("update")
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
      after: {
        funnelId: q.funnelId,
        amount: quoteNet({ subtotal: q.subtotal, discountTotal: q.discountTotal }),
      },
    })

    return {
      funnelId: q.funnelId,
      accountId: opp.accountId,
    }
  })

  revalidatePath("/quotations")
  revalidatePath(`/quotations/${id}`)
  return {
    funnelId: result.funnelId,
    accountId: result.accountId,
  }
  })
}

export async function rejectCustomerQuotation(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.QUOTATION_ACCEPT, async (tx, ctx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .limit(1)
      .for("update")
    if (!q) throw new Error("Quotation not found")
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({ ownerMemberId: funnels.ownerMemberId })
      .from(funnels)
      .where(eq(funnels.id, q.funnelId))
      .limit(1)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, opp?.ownerMemberId ?? null))
      throw new Error("FORBIDDEN: not permitted on this quotation")
    assertQuotationTransition(q.status, "rejected")
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
