"use server"

import { and, asc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import type {
  StageCode,
  StageKind,
  ProjectNature,
  ProductCategory,
  QuoteDefaults,
} from "./constants"
import {
  normalizeProjectNatureCode,
  validateProjectNatureCode,
  normalizeProductCategories,
  normalizeQuoteDefaults,
  assertTaxonomyRemovalsSafe,
  AUTO_JOIN_ROLES,
} from "./constants"
import { runInTenant, type Tx } from "@/db"
import { requireContext, assertCan, type ServerContext } from "@/lib/actions"
import { type ActionResult, runAction } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import { lockProductTaxonomy } from "@/server/services/product-taxonomy-lock"
import { PERMISSIONS } from "@/lib/permissions"
import {
  getLicenseStateForTenant,
} from "@/lib/subscription-licensing"
import { listEntities } from "@/lib/lookups"
import { storage } from "@/lib/storage"
import {
  getEntitledModuleMap,
  requireEntitledModule,
} from "@/lib/modules.server"
import {
  CUSTOM_FIELD_TYPES,
  type CustomFunnelField,
  type CustomFieldType,
} from "@/lib/stage-gate"
import {
  tenantSettings,
  membershipProfiles,
  roles,
  member,
  user,
  pipelines,
  pipelineStages,
  funnels,
  organization,
  products,
} from "@/db/schema"

export type TenantSettingsView = {
  organizationId: string
  /** Display name of the entity (organization) — editable here. */
  entityName: string
  defaultCurrency: string
  status: string
  fiscalYearStartMonth: number
  approvalBypassTier: number
  taxInclusive: boolean
  autoWinOnQuoteAccept: boolean
  allowPasswordLogin: boolean
  entityCode: string
  quoteNextNumber: number
  quotePadWidth: number
  soNextNumber: number
  soPadWidth: number
  projectNextNumber: number
  projectPadWidth: number
  industries: string[]
  countries: { name: string; states: string[] }[]
  projectNatures: ProjectNature[]
  productCodes: ProductCategory[]
  quoteDefaultNotes: string
  quoteDefaultDelivery: string
  quoteDefaultPaymentTerm: string
  customFunnelFields: CustomFunnelField[]
  autoJoinDomains: string[]
  autoJoinRole: string | null
  /** Allow-listed intercompany partner entity ids (empty = any own entity). */
  intercompanyPartnerIds: string[]
  /** Tenant currency picklist (empty = built-in defaults). */
  currencies: string[]
  /** Tenant payment-term picklist for sales orders (empty = built-in defaults). */
  paymentTerms: string[]
  /** Default quote validity in days (null = no prefill). */
  quoteValidDays: number | null
  /** Dashboard "due soon" follow-up window in days. */
  followUpDueDays: number
  /** Stale-funnel nudge threshold in days (null = off). */
  staleDealDays: number | null
  /** Auto "First contact" follow-up N days after lead creation (null = off). */
  leadFollowUpDays: number | null
  /** Finance is present in the signed deployment entitlement. */
  financeEnabled: boolean
  /** In-app documentation switch (/documentation). */
  documentationModule: boolean
  /** Invoice reminder schedule, days after due (empty = built-in default). */
  invoiceReminderDays: number[]
  /** Invoice due window in days (null = built-in default). */
  invoiceDueDays: number | null
  /** Auto-complete the project when all milestones are paid. */
  autoCompleteProjectOnPaid: boolean
  /** Auto-mirror intercompany invoices (partner share pair). */
  intercoAutoMirror: boolean
  /** Payment-split template auto-seeded onto new projects with a value. */
  milestoneTemplate: { title: string; percent: number }[]
  /** Preset country for new account addresses ("" = none). */
  defaultCountry: string
  /** Preset dialing prefix for empty phone fields ("" = none). */
  phonePrefix: string
  /** Lead source picklist (empty = built-in defaults). */
  leadSources: string[]
  /** Deal-lost / lead-disqualify reason picklist (empty = built-in defaults). */
  lossReasons: string[]
  /** Sales-order document kinds (empty = built-in defaults). */
  soDocumentKinds: string[]
  /** Company profile — printed on customer-facing documents. */
  companyProfile: CompanyProfile
  /** True when a logo has been uploaded (served at /api/tenant-logo). */
  hasLogo: boolean
  /** Subscription / licensing fields (seat licensing managed manually). */
  subscriptionPlan: string
  subscriptionStatus: "active" | "trial" | "paused" | "expired" | "cancelled"
  subscriptionSeatLimit: number | null
  subscriptionStartsAt: string
  subscriptionEndsAt: string
  activeMemberCount: number
  isSubscriptionActive: boolean
  isPlatformMaster: boolean
}

export type CompanyProfile = {
  address: string
  registrationNo: string
  phone: string
  email: string
  website: string
  bankDetails: string
  quoteFooter: string
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
  entityName: string
  defaultCurrency: string
  fiscalYearStartMonth: number
  approvalBypassTier: number
  /** Dashboard "due soon" follow-up window, 1–90 days. */
  followUpDueDays: number
  taxInclusive: boolean
  autoWinOnQuoteAccept: boolean
  allowPasswordLogin: boolean
  entityCode: string
  defaultCountry: string
  phonePrefix: string
  /** Stale-funnel nudge threshold in days (null = off). */
  staleDealDays: number | null
  /** Auto "First contact" follow-up N days after lead creation (null = off). */
  leadFollowUpDays: number | null
  /** Auto-complete the project when all milestones are paid. */
  autoCompleteProjectOnPaid: boolean
  /** Auto-mirror intercompany invoices (partner share pair). */
  intercoAutoMirror: boolean
  /** In-app documentation switch (/documentation). */
  documentationModule: boolean
  subscriptionPlan?: string
  subscriptionStatus?: SubscriptionStatusInput
  /** 0 = no hard cap, >0 is max active seats. */
  subscriptionSeatLimit?: number | null
  subscriptionStartsAt?: string | null
  subscriptionEndsAt?: string | null
}

const SUBSCRIPTION_STATUSES = [
  "active",
  "trial",
  "paused",
  "expired",
  "cancelled",
] as const
type SubscriptionStatusInput = (typeof SUBSCRIPTION_STATUSES)[number]

export type UpdateNumberingInput = {
  quoteNextNumber: number
  quotePadWidth: number
  soNextNumber: number
  soPadWidth: number
  // The project running number now resets per year and lives in
  // `project_counters`; only the zero-pad width is configured here.
  projectPadWidth: number
  /** Default quote validity in days (null = don't prefill "Valid until"). */
  quoteValidDays: number | null
  /** Invoice due window in days (null = built-in default). */
  invoiceDueDays: number | null
}

const DEFAULTS = {
  defaultCurrency: "MYR",
  status: "active" as const,
  fiscalYearStartMonth: 1,
  approvalBypassTier: 40,
  taxInclusive: false,
  autoWinOnQuoteAccept: true,
  subscriptionPlan: "Starter",
  subscriptionStatus: "active" as const,
  subscriptionSeatLimit: null,
  // Default sign-in on so a self-service tenant can't be locked out; SSO-only
  // is an explicit opt-out via the General settings toggle.
  allowPasswordLogin: true,
}

function parseDateInput(
  value: string | null | undefined,
  field: string
): Date | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid date in YYYY-MM-DD format.`)
  }
  return parsed
}

/** Tenant settings for the active org. Creates a default row if missing. */
export async function getSettings(): Promise<TenantSettingsView> {
  const financeEnabled = (await getEntitledModuleMap()).finance
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
  return runInTenant(ctx.tenantId, async (tx) => {
    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, ctx.tenantId))
      .limit(1)
    const entityName = org?.name ?? ""

    const [row] = await tx
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    const license = await getLicenseStateForTenant(tx, ctx.tenantId)

    if (!row) {
      const [created] = await tx
        .insert(tenantSettings)
        .values({ organizationId: ctx.tenantId, ...DEFAULTS })
        .returning()
      return toView(created, entityName, license, ctx.isSuperadmin, financeEnabled)
    }
    return toView(row, entityName, license, ctx.isSuperadmin, financeEnabled)
  })
}

function toView(
  row: typeof tenantSettings.$inferSelect,
  entityName = "",
  license: { activeMemberCount: number; isSubscriptionActive: boolean } = {
    activeMemberCount: 0,
    isSubscriptionActive: true,
  },
  isPlatformMaster = false,
  financeEnabled = false
): TenantSettingsView {
  return {
    organizationId: row.organizationId,
    entityName,
    defaultCurrency: row.defaultCurrency,
    status: row.status,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    approvalBypassTier: row.approvalBypassTier,
    taxInclusive: row.taxInclusive,
    autoWinOnQuoteAccept: row.autoWinOnQuoteAccept,
    allowPasswordLogin: true,
    entityCode: row.entityCode ?? "",
    quoteNextNumber: row.quoteNextNumber,
    quotePadWidth: row.quotePadWidth,
    soNextNumber: row.soNextNumber,
    soPadWidth: row.soPadWidth,
    projectNextNumber: row.projectNextNumber,
    projectPadWidth: row.projectPadWidth,
    industries: row.industries ?? [],
    countries: row.countries ?? [],
    projectNatures: row.projectNatures ?? [],
    productCodes: row.productCodes ?? [],
    quoteDefaultNotes: row.quoteDefaultNotes ?? "",
    quoteDefaultDelivery: row.quoteDefaultDelivery ?? "",
    quoteDefaultPaymentTerm: row.quoteDefaultPaymentTerm ?? "",
    customFunnelFields: row.customFunnelFields ?? [],
    autoJoinDomains: row.autoJoinDomains ?? [],
    autoJoinRole: row.autoJoinRole ?? null,
    intercompanyPartnerIds: row.intercompanyPartnerIds ?? [],
    currencies: row.currencies ?? [],
    paymentTerms: row.paymentTerms ?? [],
    quoteValidDays: row.quoteValidDays ?? null,
    followUpDueDays: row.followUpDueDays ?? 7,
    staleDealDays: row.staleDealDays ?? null,
    leadFollowUpDays: row.leadFollowUpDays ?? null,
    financeEnabled,
    documentationModule: row.documentationModule,
    invoiceReminderDays: row.invoiceReminderDays ?? [],
    invoiceDueDays: row.invoiceDueDays ?? null,
    autoCompleteProjectOnPaid: row.autoCompleteProjectOnPaid,
    intercoAutoMirror: row.intercoAutoMirror,
    milestoneTemplate: row.milestoneTemplate ?? [],
    defaultCountry: row.defaultCountry ?? "",
    phonePrefix: row.phonePrefix ?? "",
    leadSources: row.leadSources ?? [],
    lossReasons: row.lossReasons ?? [],
    soDocumentKinds: row.soDocumentKinds ?? [],
    companyProfile: {
      address: row.companyAddress ?? "",
      registrationNo: row.companyRegistrationNo ?? "",
      phone: row.companyPhone ?? "",
      email: row.companyEmail ?? "",
      website: row.companyWebsite ?? "",
      bankDetails: row.bankDetails ?? "",
      quoteFooter: row.quoteFooter ?? "",
    },
    hasLogo: !!row.logoStorageKey,
    subscriptionPlan: row.subscriptionPlan ?? "Starter",
    subscriptionStatus: (row.subscriptionStatus as
      | "active"
      | "trial"
      | "paused"
      | "expired"
      | "cancelled") || "active",
    subscriptionSeatLimit: row.subscriptionSeatLimit ?? null,
    subscriptionStartsAt: row.subscriptionStartsAt
      ? row.subscriptionStartsAt.toISOString().slice(0, 10)
      : "",
    subscriptionEndsAt: row.subscriptionEndsAt
      ? row.subscriptionEndsAt.toISOString().slice(0, 10)
      : "",
    activeMemberCount: license.activeMemberCount,
    isSubscriptionActive: license.isSubscriptionActive,
    isPlatformMaster,
  }
}

async function toViewWithLicense(
  tx: Tx,
  row: typeof tenantSettings.$inferSelect,
  entityName = "",
  tenantId = row.organizationId
): Promise<TenantSettingsView> {
  const license = await getLicenseStateForTenant(tx, tenantId)
  const financeEnabled = (await getEntitledModuleMap()).finance
  return toView(row, entityName, license, false, financeEnabled)
}

/** Shared helper: replace one jsonb picklist column with an audited upsert. */
async function updatePicklist(
  field:
    | "currencies"
    | "paymentTerms"
    | "leadSources"
    | "lossReasons"
    | "soDocumentKinds",
  values: string[],
  auditAction: string
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    const unique = [...new Set(values.map((s) => s.trim()).filter(Boolean))]
    if (field === "currencies") {
      for (const c of unique) {
        if (!/^[A-Z]{3}$/.test(c)) {
          throw new Error(`"${c}" is not a 3-letter ISO currency code.`)
        }
      }
    }
    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          ...DEFAULTS,
          [field]: unique,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { [field]: unique, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: auditAction,
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { [field]: unique },
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })
    revalidatePath("/settings")
    return view
  })
}

/** Replace the tenant currency picklist (ISO-4217 codes, upper-cased). */
export async function updateCurrencies(
  codes: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return updatePicklist(
    "currencies",
    codes.map((c) => c.trim().toUpperCase()),
    "settings.currencies_updated"
  )
}

/** Replace the tenant payment-term picklist for sales orders. */
export async function updatePaymentTerms(
  terms: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return updatePicklist(
    "paymentTerms",
    terms,
    "settings.payment_terms_updated"
  )
}

/** Replace the lead-source picklist. */
export async function updateLeadSources(
  sources: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return updatePicklist("leadSources", sources, "settings.lead_sources_updated")
}

/** Replace the shared deal-lost / lead-disqualify reason picklist. */
export async function updateLossReasons(
  reasons: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return updatePicklist("lossReasons", reasons, "settings.loss_reasons_updated")
}

/** Replace the sales-order document-kind picklist. */
export async function updateSoDocumentKinds(
  kinds: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return updatePicklist(
    "soDocumentKinds",
    kinds,
    "settings.so_document_kinds_updated"
  )
}

/**
 * Save the company profile (printed on customer-facing documents). All fields
 * optional free text; length-capped so a paste can't blow up the quote layout.
 */
export async function updateCompanyProfile(
  input: CompanyProfile
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

    const clip = (s: string, max: number) => (s ?? "").trim().slice(0, max)
    const values = {
      companyAddress: clip(input.address, 500) || null,
      companyRegistrationNo: clip(input.registrationNo, 120) || null,
      companyPhone: clip(input.phone, 60) || null,
      companyEmail: clip(input.email, 200) || null,
      companyWebsite: clip(input.website, 200) || null,
      bankDetails: clip(input.bankDetails, 1000) || null,
      quoteFooter: clip(input.quoteFooter, 2000) || null,
      updatedAt: new Date(),
    }

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({ organizationId: ctx.tenantId, ...DEFAULTS, ...values })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: values,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.company_profile_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: values,
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })

    revalidatePath("/settings")
    return view
  })
}

/** Save the text copied into new quotation Notes, Delivery, and Payment Term. */
export async function updateQuoteDefaults(
  input: QuoteDefaults
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    const normalized = normalizeQuoteDefaults(input)
    const values = {
      quoteDefaultNotes: normalized.notes || null,
      quoteDefaultDelivery: normalized.delivery || null,
      quoteDefaultPaymentTerm: normalized.paymentTerm || null,
      updatedAt: new Date(),
    }

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({ organizationId: ctx.tenantId, ...DEFAULTS, ...values })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: values,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.quote_defaults_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: values,
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })

    revalidatePath("/settings")
    return view
  })
}

/**
 * Replace the payment-milestone template. Titles required; percents must be
 * positive and sum to at most 100 (a sum below 100 leaves the remainder
 * unallocated, which is allowed — the team adds the tail manually).
 */
export async function updateMilestoneTemplate(
  template: { title: string; percent: number }[]
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

    const cleaned = template.map((t) => ({
      title: (t.title ?? "").trim().slice(0, 120),
      percent: Number(t.percent),
    }))
    let sum = 0
    for (const t of cleaned) {
      if (!t.title) throw new Error("Every milestone needs a title.")
      if (!Number.isFinite(t.percent) || t.percent <= 0 || t.percent > 100) {
        throw new Error("Each percent must be between 0 and 100.")
      }
      sum += t.percent
    }
    if (sum > 100.0001) {
      throw new Error("The milestone percents add up to more than 100%.")
    }

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          ...DEFAULTS,
          milestoneTemplate: cleaned,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { milestoneTemplate: cleaned, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.milestone_template_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { milestoneTemplate: cleaned },
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })
    revalidatePath("/settings")
    return view
  })
}

/** Replace the invoice reminder schedule (days after due; sorted, unique). */
export async function updateInvoiceReminderDays(
  days: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    await requireEntitledModule("finance")
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    const parsed = [...new Set(days.map((d) => Number(d.trim())))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365)
      .sort((a, b) => a - b)
    if (parsed.length !== days.filter((d) => d.trim()).length) {
      throw new Error("Each reminder must be a whole number of days (1–365).")
    }
    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          ...DEFAULTS,
          invoiceReminderDays: parsed,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { invoiceReminderDays: parsed, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.invoice_reminders_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { invoiceReminderDays: parsed },
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })
    revalidatePath("/settings")
    return view
  })
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"])

/** Upload (replace) the company logo; served at /api/tenant-logo. */
export async function uploadCompanyLogo(
  formData: FormData
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick an image file.")
    }
    if (!LOGO_TYPES.has(file.type)) {
      throw new Error("Logo must be a PNG, JPEG, WebP or SVG image.")
    }
    if (file.size > 2 * 1024 * 1024) throw new Error("Logo exceeds 2 MB.")

    const buf = Buffer.from(await file.arrayBuffer())
    const stored = await storage.put(ctx.tenantId, file.name, buf)

    await runInTenant(ctx.tenantId, async (tx) => {
      const [prev] = await tx
        .select({ key: tenantSettings.logoStorageKey })
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          ...DEFAULTS,
          logoStorageKey: stored.key,
          logoContentType: file.type,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: {
            logoStorageKey: stored.key,
            logoContentType: file.type,
            updatedAt: new Date(),
          },
        })
      await writeAudit(tx, ctx, {
        action: "settings.logo_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
      })
      // Best-effort cleanup of the replaced blob (post-commit orphan is fine).
      if (prev?.key) await storage.delete(prev.key).catch(() => {})
    })
    revalidatePath("/settings")
  })
}

/** Remove the company logo. */
export async function removeCompanyLogo(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    await runInTenant(ctx.tenantId, async (tx) => {
      const [prev] = await tx
        .select({ key: tenantSettings.logoStorageKey })
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      await tx
        .update(tenantSettings)
        .set({
          logoStorageKey: null,
          logoContentType: null,
          updatedAt: new Date(),
        })
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
      await writeAudit(tx, ctx, {
        action: "settings.logo_removed",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
      })
      if (prev?.key) await storage.delete(prev.key).catch(() => {})
    })
    revalidatePath("/settings")
  })
}

/**
 * Replace the intercompany partner allow-list. Every id must be an entity the
 * caller belongs to (there is no directory of foreign orgs to pick from).
 * An empty list restores the legacy behavior (any own entity is a valid
 * handling partner).
 */
export async function updateIntercompanyPartners(
  ids: string[]
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
    await requireEntitledModule("finance")
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

    const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))]
    const entities = await listEntities()
    const valid = new Set(entities.map((e) => e.id))
    for (const id of unique) {
      if (!valid.has(id)) {
        throw new Error(
          "Each allow-listed partner must be an entity you belong to."
        )
      }
    }

    const view = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          ...DEFAULTS,
          intercompanyPartnerIds: unique,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { intercompanyPartnerIds: unique, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.intercompany_partners_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { intercompanyPartnerIds: unique },
      })
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, ctx.tenantId))
        .limit(1)
      return await toViewWithLicense(tx, updated, org?.name ?? "", ctx.tenantId)
    })

    revalidatePath("/settings")
    return view
  })
}

/** Update (upsert) the general tenant settings row. */
export async function updateSettings(
  input: UpdateSettingsInput
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
  const financeEnabled = (await getEntitledModuleMap()).finance
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
  const subscriptionMutationRequested =
    input.subscriptionPlan !== undefined ||
    input.subscriptionStatus !== undefined ||
    input.subscriptionSeatLimit !== undefined ||
    input.subscriptionStartsAt !== undefined ||
    input.subscriptionEndsAt !== undefined
  if (subscriptionMutationRequested) {
    throw new Error("Subscription licensing is controlled by the signed deployment entitlement.")
  }

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
  if (
    !Number.isInteger(input.followUpDueDays) ||
    input.followUpDueDays < 1 ||
    input.followUpDueDays > 90
  ) {
    throw new Error("Follow-up window must be between 1 and 90 days.")
  }
  for (const [label, n] of [
    ["Stale funnel threshold", input.staleDealDays],
    ["Lead follow-up days", input.leadFollowUpDays],
  ] as const) {
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 365)) {
      throw new Error(`${label} must be between 1 and 365 days (or empty).`)
    }
  }

  const entityCode = (input.entityCode ?? "").trim().toUpperCase()

  const entityName = (input.entityName ?? "").trim()
  if (entityName.length === 0) throw new Error("Entity name is required.")
  if (entityName.length > 120) throw new Error("Entity name is too long.")

  const values = {
    defaultCurrency: currency,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    approvalBypassTier: input.approvalBypassTier,
    followUpDueDays: input.followUpDueDays,
    taxInclusive: input.taxInclusive,
    autoWinOnQuoteAccept: input.autoWinOnQuoteAccept,
    staleDealDays: input.staleDealDays,
    leadFollowUpDays: input.leadFollowUpDays,
    ...(financeEnabled
      ? {
          autoCompleteProjectOnPaid: input.autoCompleteProjectOnPaid,
          intercoAutoMirror: input.intercoAutoMirror,
        }
      : {}),
    documentationModule: input.documentationModule,
    // Password sign-in is always enabled. Keep the legacy column for
    // compatibility with older tenants and migrations.
    allowPasswordLogin: true,
    entityCode: entityCode.length > 0 ? entityCode : null,
    defaultCountry: (input.defaultCountry ?? "").trim() || null,
    phonePrefix: (input.phonePrefix ?? "").trim().slice(0, 8) || null,
    updatedAt: new Date(),
  }

  const view = await runInTenant(ctx.tenantId, async (tx) => {
    // Rename the entity (organization). The name lives on the better-auth
    // `organization` row, not tenant_settings.
    await tx
      .update(organization)
      .set({ name: entityName })
      .where(eq(organization.id, ctx.tenantId))

    const [existing] = await tx
      .select({
        subscriptionPlan: tenantSettings.subscriptionPlan,
        subscriptionStatus: tenantSettings.subscriptionStatus,
        subscriptionSeatLimit: tenantSettings.subscriptionSeatLimit,
        subscriptionStartsAt: tenantSettings.subscriptionStartsAt,
        subscriptionEndsAt: tenantSettings.subscriptionEndsAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    const subscriptionPlan = (input.subscriptionPlan ?? existing?.subscriptionPlan ?? "Starter").trim()
    const subscriptionStatus = (input.subscriptionStatus ??
      (existing?.subscriptionStatus ?? DEFAULTS.subscriptionStatus))
    if (!SUBSCRIPTION_STATUSES.includes(subscriptionStatus as SubscriptionStatusInput)) {
      throw new Error("subscriptionStatus is invalid.")
    }

    const rawSeatLimitInput = input.subscriptionSeatLimit
    const subscriptionSeatLimit =
      rawSeatLimitInput === undefined
        ? existing?.subscriptionSeatLimit
        : rawSeatLimitInput == null || rawSeatLimitInput <= 0
          ? null
          : rawSeatLimitInput

    if (
      subscriptionSeatLimit != null &&
      (!Number.isInteger(subscriptionSeatLimit) || subscriptionSeatLimit < 1)
    ) {
      throw new Error(
        "subscriptionSeatLimit must be a positive integer or zero/null for unlimited."
      )
    }

    const startsAt = input.subscriptionStartsAt === undefined
      ? existing?.subscriptionStartsAt ?? null
      : parseDateInput(input.subscriptionStartsAt, "subscriptionStartsAt")
    const endsAt = input.subscriptionEndsAt === undefined
      ? existing?.subscriptionEndsAt ?? null
      : parseDateInput(input.subscriptionEndsAt, "subscriptionEndsAt")
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new Error("subscriptionStartsAt must be on or before subscriptionEndsAt.")
    }

    const subscriptionValues = {
      subscriptionPlan,
      subscriptionStatus: subscriptionStatus as SubscriptionStatusInput,
      subscriptionSeatLimit,
      subscriptionStartsAt: startsAt,
      subscriptionEndsAt: endsAt,
    }

    const [updated] = await tx
      .insert(tenantSettings)
      .values({
        organizationId: ctx.tenantId,
        status: "active",
        ...values,
        ...subscriptionValues,
      })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: { ...values, ...subscriptionValues },
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: { ...values, ...subscriptionValues, entityName },
    })
    return await toViewWithLicense(tx, updated, entityName, ctx.tenantId)
  })

  revalidatePath("/settings")
  // The entity name is shown in the sidebar/header (rendered by the app layout).
  revalidatePath("/", "layout")
  return view
  })
}

/** Update quotation + project numbering configuration. */
export async function updateNumbering(
  input: UpdateNumberingInput
): Promise<ActionResult<TenantSettingsView>> {
  return runAction(async () => {
  const financeEnabled = (await getEntitledModuleMap()).finance
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  if (!Number.isInteger(input.quoteNextNumber) || input.quoteNextNumber < 1) {
    throw new Error("Quotation next number must be a positive integer.")
  }
  if (!Number.isInteger(input.soNextNumber) || input.soNextNumber < 1) {
    throw new Error("Sales-order next number must be a positive integer.")
  }
  for (const [label, n] of [
    ["Quotation pad width", input.quotePadWidth],
    ["Sales-order pad width", input.soPadWidth],
    ["Project pad width", input.projectPadWidth],
  ] as const) {
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(`${label} must be between 1 and 10.`)
    }
  }
  if (
    input.quoteValidDays !== null &&
    (!Number.isInteger(input.quoteValidDays) ||
      input.quoteValidDays < 1 ||
      input.quoteValidDays > 365)
  ) {
    throw new Error("Default validity must be between 1 and 365 days.")
  }
  if (
    financeEnabled &&
    input.invoiceDueDays !== null &&
    (!Number.isInteger(input.invoiceDueDays) ||
      input.invoiceDueDays < 1 ||
      input.invoiceDueDays > 365)
  ) {
    throw new Error("Invoice due window must be between 1 and 365 days.")
  }

  const values = {
    quoteNextNumber: input.quoteNextNumber,
    quotePadWidth: input.quotePadWidth,
    soNextNumber: input.soNextNumber,
    soPadWidth: input.soPadWidth,
    // projectNextNumber is intentionally not written here — the project running
    // number resets per year and is minted from `project_counters`.
    projectPadWidth: input.projectPadWidth,
    quoteValidDays: input.quoteValidDays,
    ...(financeEnabled ? { invoiceDueDays: input.invoiceDueDays } : {}),
    updatedAt: new Date(),
  }

  const view = await runInTenant(ctx.tenantId, async (tx) => {
    // The stored quote/SO counters are always (highest issued number + 1).
    // Lowering either below its current value would re-issue numbers already on
    // live documents and surface later as cryptic unique-constraint failures.
    const [current] = await tx
      .select({
        quoteNextNumber: tenantSettings.quoteNextNumber,
        soNextNumber: tenantSettings.soNextNumber,
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
      if (input.soNextNumber < current.soNextNumber) {
        throw new Error(
          `Sales-order next number can't go below ${current.soNextNumber} — number ${current.soNextNumber - 1} has already been issued.`
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
    return await toViewWithLicense(tx, updated, undefined, ctx.tenantId)
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

/**
 * Replace the tenant's country → states picklist (account addresses). Country
 * names are de-duplicated (case-insensitive); each country's states are trimmed
 * and de-duplicated within that country.
 */
export async function updateCountries(
  countries: { name: string; states: string[] }[]
): Promise<ActionResult<{ name: string; states: string[] }[]>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

    const cleaned: { name: string; states: string[] }[] = []
    const seenCountry = new Set<string>()
    for (const raw of countries) {
      const name = (raw?.name ?? "").trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (seenCountry.has(key)) continue
      seenCountry.add(key)
      const states: string[] = []
      const seenState = new Set<string>()
      for (const s of raw.states ?? []) {
        const st = (s ?? "").trim()
        if (!st) continue
        const sk = st.toLowerCase()
        if (seenState.has(sk)) continue
        seenState.add(sk)
        states.push(st)
      }
      states.sort((a, b) => a.localeCompare(b))
      cleaned.push({ name, states })
    }
    cleaned.sort((a, b) => a.name.localeCompare(b.name))

    const saved = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({ organizationId: ctx.tenantId, status: "active", countries: cleaned })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { countries: cleaned, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.countries_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { countries: cleaned },
      })
      return updated.countries ?? []
    })

    revalidatePath("/settings")
    return saved
  })
}

/** Replace the tenant's project-nature picklist (used in project codes). */
export async function updateProjectNatures(
  projectNatures: ProjectNature[]
): Promise<ActionResult<ProjectNature[]>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  const cleaned: ProjectNature[] = []
  const seenCodes = new Set<string>()
  for (const raw of projectNatures ?? []) {
    const code = normalizeProjectNatureCode(raw?.code ?? "")
    const name = (raw?.name ?? "").trim()
    const codeError = validateProjectNatureCode(code)
    if (codeError) throw new Error(codeError)
    if (name.length === 0) {
      throw new Error(`Name is required for project nature "${code}".`)
    }
    if (seenCodes.has(code)) {
      throw new Error(`Duplicate project-nature code "${code}".`)
    }
    seenCodes.add(code)
    cleaned.push({ code, name })
  }
  cleaned.sort((a, b) => a.code.localeCompare(b.code))

  const saved = await runInTenant(ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .insert(tenantSettings)
      .values({
        organizationId: ctx.tenantId,
        status: "active",
        projectNatures: cleaned,
      })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: { projectNatures: cleaned, updatedAt: new Date() },
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.project_natures_updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: { projectNatures: cleaned },
    })
    return updated.projectNatures ?? []
  })

  revalidatePath("/settings")
  return saved
  })
}

/** Replace the tenant's product-code picklist (product lines for the catalog). */
export async function updateProductCodes(
  productCodes: ProductCategory[]
): Promise<ActionResult<ProductCategory[]>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)
    const cleaned = normalizeProductCategories(productCodes ?? [])

    const saved = await runInTenant(ctx.tenantId, async (tx) => {
      await lockProductTaxonomy(tx, ctx.tenantId)
      const [current] = await tx
        .select({ productCodes: tenantSettings.productCodes })
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      const references = await tx
        .select({ productCode: products.productCode, subcategory: products.subcategory })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)))
      assertTaxonomyRemovalsSafe(current?.productCodes ?? [], cleaned, references)

      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          status: "active",
          productCodes: cleaned,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: { productCodes: cleaned, updatedAt: new Date() },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.product_codes_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { productCodes: cleaned },
      })
      return updated.productCodes ?? []
    })

    revalidatePath("/settings")
    revalidatePath("/products")
    return saved
  })
}

/**
 * Tenant-defined custom funnel fields. Each row is a free-text label; the key is
 * auto-slugged (prefixed `cf_` so it can never collide with a preset field key)
 * and stays stable so existing data/requirements keep referencing it.
 */
export async function updateCustomFunnelFields(
  fields: {
    key?: string
    label: string
    type?: string
    options?: string[]
    description?: string
    category?: string
  }[]
): Promise<ActionResult<CustomFunnelField[]>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.TENANT_SETTINGS)

  const validTypes = new Set(CUSTOM_FIELD_TYPES.map((t) => t.value))
  const cleaned: CustomFunnelField[] = []
  const seen = new Set<string>()
  for (const raw of fields ?? []) {
    const label = (raw?.label ?? "").trim()
    if (!label) continue // skip blank rows
    let key = (raw?.key ?? "").trim()
    if (!key) {
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40)
      key = `cf_${slug || "field"}`
    }
    if (!key.startsWith("cf_")) key = `cf_${key}`
    if (seen.has(key)) {
      let i = 2
      while (seen.has(`${key}_${i}`)) i++
      key = `${key}_${i}`
    }
    seen.add(key)
    const type: CustomFieldType = validTypes.has(raw?.type as CustomFieldType)
      ? (raw!.type as CustomFieldType)
      : "text"
    const options =
      type === "select"
        ? (raw?.options ?? [])
            .map((o) => o.trim())
            .filter((o) => o.length > 0)
        : undefined
    const description = (raw?.description ?? "").trim() || undefined
    const category = (raw?.category ?? "").trim() || undefined
    cleaned.push({
      key,
      label,
      type,
      ...(options ? { options } : {}),
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
    })
  }

  const saved = await runInTenant(ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .insert(tenantSettings)
      .values({
        organizationId: ctx.tenantId,
        status: "active",
        customFunnelFields: cleaned,
      })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: { customFunnelFields: cleaned, updatedAt: new Date() },
      })
      .returning()
    await writeAudit(tx, ctx, {
      action: "settings.custom_funnel_fields_updated",
      entityType: "tenant_settings",
      entityId: ctx.tenantId,
      after: { customFunnelFields: cleaned },
    })
    return updated.customFunnelFields ?? []
  })

  revalidatePath("/settings")
  return saved
  })
}

/**
 * Configure domain auto-join: which email domains join this workspace on first
 * SSO login, and the role they land with. Empty domains = invite-only.
 */
export async function updateAutoJoin(input: {
  domains: string[]
  role: string | null
}): Promise<ActionResult<{ domains: string[]; role: string | null }>> {
  return runAction(async () => {
    const ctx = await requireContext()
    assertCan(ctx, PERMISSIONS.TENANT_MANAGE_USERS)
    const domains = Array.from(
      new Set(
        (input.domains ?? [])
          .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
          .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
      )
    )
    const role =
      input.role && AUTO_JOIN_ROLES.includes(input.role) ? input.role : null
    const saved = await runInTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .insert(tenantSettings)
        .values({
          organizationId: ctx.tenantId,
          status: "active",
          autoJoinDomains: domains,
          autoJoinRole: role,
        })
        .onConflictDoUpdate({
          target: tenantSettings.organizationId,
          set: {
            autoJoinDomains: domains,
            autoJoinRole: role,
            updatedAt: new Date(),
          },
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "settings.auto_join_updated",
        entityType: "tenant_settings",
        entityId: ctx.tenantId,
        after: { autoJoinDomains: domains, autoJoinRole: role },
      })
      return {
        domains: updated.autoJoinDomains ?? [],
        role: updated.autoJoinRole ?? null,
      }
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

export type FunnelStageRow = typeof pipelineStages.$inferSelect

export type DefaultFunnelView = {
  pipelineId: string | null
  funnelName: string | null
  stages: FunnelStageRow[]
}

export type StageUpdateInput = {
  name: string
  probability: string
  requiresApprovalToEnter: boolean
  includeInForecast: boolean
  sortOrder: number
  /** Configurable entry requirements (RequirableFieldKey values). */
  requiredFields: string[]
}

export type StageCreateInput = StageUpdateInput & {
  code: StageCode
  kind: StageKind
}

/** Valid requirement keys for a stage: preset fields + the tenant's custom fields. */
async function allowedRequiredKeys(
  tx: Tx,
  tenantId: string
): Promise<Set<string>> {
  const [s] = await tx
    .select({ c: tenantSettings.customFunnelFields })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  // Only the tenant's own custom fields can gate a stage (no preset fields).
  const keys = new Set<string>()
  for (const f of s?.c ?? []) keys.add(f.key)
  return keys
}

/** Resolve the tenant's default funnel id (falls back to first active funnel). */
async function resolveDefaultFunnelId(
  tx: Tx,
  tenantId: string
): Promise<string | null> {
  const all = await tx
    .select()
    .from(pipelines)
    .where(eq(pipelines.tenantId, tenantId))
    .orderBy(asc(pipelines.name))
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
      .from(pipelines)
      .where(eq(pipelines.tenantId, ctx.tenantId))
      .orderBy(asc(pipelines.name))
    const def =
      all.find((f) => f.isDefault) ?? all.find((f) => f.isActive) ?? all[0]
    if (!def) return { pipelineId: null, funnelName: null, stages: [] }
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, def.id))
      .orderBy(asc(pipelineStages.sortOrder))
    return { pipelineId: def.id, funnelName: def.name, stages }
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
    const allowed = await allowedRequiredKeys(tx, ctx.tenantId)
    const [updated] = await tx
      .update(pipelineStages)
      .set({
        name: input.name.trim(),
        probability: input.probability,
        requiresApprovalToEnter: input.requiresApprovalToEnter,
        includeInForecast: input.includeInForecast,
        sortOrder: input.sortOrder,
        requiredFields: input.requiredFields.filter((k) => allowed.has(k)),
        updatedAt: new Date(),
      })
      .where(eq(pipelineStages.id, id))
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
    const allowed = await allowedRequiredKeys(tx, ctx.tenantId)
    const pipelineId = await resolveDefaultFunnelId(tx, ctx.tenantId)
    if (!pipelineId) throw new Error("No funnel configured for this entity.")

    const existing = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
    if (existing.some((s) => s.code === input.code)) {
      throw new Error(`Stage code "${input.code}" already exists in this funnel.`)
    }
    if (existing.some((s) => s.sortOrder === input.sortOrder)) {
      throw new Error(`Sort order ${input.sortOrder} is already used.`)
    }

    const [created] = await tx
      .insert(pipelineStages)
      .values({
        tenantId: ctx.tenantId,
        pipelineId,
        code: input.code,
        name: input.name.trim(),
        probability: input.probability,
        kind: input.kind,
        sortOrder: input.sortOrder,
        requiresApprovalToEnter: input.requiresApprovalToEnter,
        includeInForecast: input.includeInForecast,
        requiredFields: input.requiredFields.filter((k) => allowed.has(k)),
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
      .from(pipelineStages)
      .where(eq(pipelineStages.id, id))
      .limit(1)
    if (!before) throw new Error("Stage not found.")

    // Refuse to orphan live deals: a stage with non-deleted funnels
    // referencing it can't be hard-deleted (it would break the board + forecast).
    const inUse = await tx
      .select({ id: funnels.id })
      .from(funnels)
      .where(
        and(
          eq(funnels.currentStageId, id),
          isNull(funnels.deletedAt)
        )
      )
      .limit(1)
    if (inUse.length > 0) {
      throw new Error(
        "This stage still has pipelines in it. Move them to another stage before deleting it."
      )
    }

    await tx.delete(pipelineStages).where(eq(pipelineStages.id, id))
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
 * unique (pipelineId, sortOrder) constraint mid-update).
 */
export async function reorderStages(order: string[]): Promise<ActionResult<void>> {
  return runAction(async () => {
  const ctx = await requireContext()
  assertCan(ctx, PERMISSIONS.FUNNEL_MANAGE)
  await runInTenant(ctx.tenantId, async (tx) => {
    const pipelineId = await resolveDefaultFunnelId(tx, ctx.tenantId)
    if (!pipelineId) throw new Error("No funnel configured for this entity.")
    // Two-phase write to dodge the (pipelineId, sortOrder) unique constraint.
    const OFFSET = 1000
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ sortOrder: i + OFFSET, updatedAt: new Date() })
        .where(
          and(eq(pipelineStages.id, order[i]), eq(pipelineStages.pipelineId, pipelineId))
        )
    }
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(eq(pipelineStages.id, order[i]), eq(pipelineStages.pipelineId, pipelineId))
        )
    }
    await writeAudit(tx, ctx, {
      action: "stage.reordered",
      entityType: "funnel",
      entityId: pipelineId,
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
