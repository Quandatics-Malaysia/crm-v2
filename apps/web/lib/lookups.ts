import "server-only"
import { and, eq, isNull, asc, ne } from "drizzle-orm"
import { db, runInTenant } from "@/db"
import {
  member,
  user,
  organization,
  accounts,
  pipelines,
  pipelineStages,
  taxSettings,
  tenantSettings,
  products,
} from "@/db/schema"
import { requireContext } from "@/lib/server-context"
import { visibleMemberIds, ownerScope } from "@/lib/access-scope"
import {
  DEFAULT_CURRENCIES,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LOSS_REASONS,
} from "@/lib/tenant-defaults"

export type MemberOption = { memberId: string; name: string; email: string }
export type Option = { id: string; name: string; currency?: string }

/** Members of the active tenant — for owner / assignee selects. */
export async function listMembers(): Promise<MemberOption[]> {
  const ctx = await requireContext()
  return db
    .select({ memberId: member.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId))
}

export async function listAccountOptions(): Promise<Option[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          ownerScope(accounts.ownerMemberId, visible)
        )
      )
      .orderBy(asc(accounts.name))
  })
}

export type FunnelWithStages = {
  id: string
  name: string
  isDefault: boolean
  stages: {
    id: string
    code: string
    name: string
    kind: string
    sortOrder: number
    probability: string
    requiresApprovalToEnter: boolean
    requiredFields: string[]
  }[]
}

export async function listFunnelsWithStages(): Promise<FunnelWithStages[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, async (tx) => {
    const fs = await tx
      .select()
      .from(pipelines)
      .where(eq(pipelines.tenantId, ctx.tenantId))
      .orderBy(asc(pipelines.name))
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.tenantId, ctx.tenantId))
      .orderBy(asc(pipelineStages.sortOrder))
    return fs.map((f) => ({
      id: f.id,
      name: f.name,
      isDefault: f.isDefault,
      stages: stages
        .filter((s) => s.pipelineId === f.id)
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          kind: s.kind,
          sortOrder: s.sortOrder,
          probability: s.probability,
          requiresApprovalToEnter: s.requiresApprovalToEnter,
          requiredFields: s.requiredFields,
        })),
    }))
  })
}

/** Configurable industry picklist for the tenant. */
export async function listIndustries(): Promise<string[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ industries: tenantSettings.industries })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.industries ?? []
}

/**
 * The OTHER entities (organizations) the current user belongs to — the valid
 * targets for an intercompany handling partner. Excludes the active entity;
 * intercompany transfers only ever go to a sibling group entity, never an
 * external customer account. Read on the base connection (cross-tenant by
 * design — a user's own memberships).
 */
export async function listEntities(): Promise<Option[]> {
  const ctx = await requireContext()
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, ctx.userId), ne(organization.id, ctx.tenantId)))
  return rows.map((r) => ({ id: r.id, name: r.name }))
}

/**
 * Tenant currency picklist (Settings → General); falls back to the built-in
 * defaults when unconfigured. First entry = default currency for new deals.
 */
export async function listCurrencies(): Promise<string[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ currencies: tenantSettings.currencies })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.currencies?.length ? s.currencies : DEFAULT_CURRENCIES
}

export type FormPresets = {
  /** Preset country for new account addresses ("" = none). */
  defaultCountry: string
  /** Preset dialing prefix for empty phone fields ("" = none). */
  phonePrefix: string
}

/** Tenant form presets (Settings → General) — prefill values that reduce
 *  repetitive typing and typos on create forms. */
export async function getFormPresets(): Promise<FormPresets> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        defaultCountry: tenantSettings.defaultCountry,
        phonePrefix: tenantSettings.phonePrefix,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return {
    defaultCountry: s?.defaultCountry ?? "",
    phonePrefix: s?.phonePrefix ?? "",
  }
}

/** Lead-source picklist (Settings → Industries tab); built-in defaults when unset. */
export async function listLeadSources(): Promise<string[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ leadSources: tenantSettings.leadSources })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.leadSources?.length ? s.leadSources : DEFAULT_LEAD_SOURCES
}

/** Loss/disqualify reason picklist; built-in defaults when unset. */
export async function listLossReasons(): Promise<string[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ lossReasons: tenantSettings.lossReasons })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.lossReasons?.length ? s.lossReasons : DEFAULT_LOSS_REASONS
}

export type CountryOption = { name: string; states: string[] }

/** Tenant-configured country → states picklist for account addresses. */
export async function listCountries(): Promise<CountryOption[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ countries: tenantSettings.countries })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.countries ?? []
}

/**
 * Tenant-managed project-nature picklist (code + display name). Flows
 * Funnel → Quotation → Project. Read from tenant_settings, tenant-scoped.
 */
export async function listProjectNatures(): Promise<{ code: string; name: string }[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ projectNatures: tenantSettings.projectNatures })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.projectNatures ?? []
}

/** Tenant-defined custom funnel fields ({ key, label }) — for the funnel form
 *  and the per-stage requirement gate. */
export async function listCustomFunnelFields(): Promise<
  { key: string; label: string }[]
> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ customFunnelFields: tenantSettings.customFunnelFields })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.customFunnelFields ?? []
}

/**
 * Tenant-managed product-code picklist (code + display name) for product lines.
 * Standardised products reference one of these. Read from tenant_settings.
 */
export async function listProductCodes(): Promise<{ code: string; name: string }[]> {
  const ctx = await requireContext()
  const [s] = await runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({ productCodes: tenantSettings.productCodes })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
  )
  return s?.productCodes ?? []
}

export type ProductOption = {
  id: string
  name: string
  description: string | null
  standardPrice: string
  currency: string
  uom: string | null
}

/**
 * Active, non-deleted products for the quotation line-item picker. Selecting one
 * fills in the line's description + unit price (and UOM).
 */
export async function listProductOptions(): Promise<ProductOption[]> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        standardPrice: products.standardPrice,
        currency: products.currency,
        uom: products.uom,
      })
      .from(products)
      .where(
        and(
          eq(products.tenantId, ctx.tenantId),
          eq(products.isActive, true),
          isNull(products.deletedAt)
        )
      )
      .orderBy(asc(products.name))
  )
}

export async function listTaxOptions(): Promise<
  { id: string; name: string; ratePercent: string; isDefault: boolean }[]
> {
  const ctx = await requireContext()
  return runInTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: taxSettings.id,
        name: taxSettings.name,
        ratePercent: taxSettings.ratePercent,
        isDefault: taxSettings.isDefault,
      })
      .from(taxSettings)
      .where(eq(taxSettings.isActive, true))
      .orderBy(asc(taxSettings.name))
  )
}
