import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { tenantSettings } from "@/db/schema"
import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"

export function configuredCurrencies(
  currencies: readonly string[] | null | undefined
): string[] {
  const configured = Array.isArray(currencies) ? currencies : null
  const values = Array.from(
    new Set(
      (configured?.length ? configured : DEFAULT_CURRENCIES)
        .map((currency) => currency.trim().toUpperCase())
        .filter((currency) => /^[A-Z]{3}$/.test(currency))
    )
  )
  return values.length ? values : ["MYR"]
}

export function resolveConfiguredCurrency(
  requested: string | null | undefined,
  currencies: readonly string[] | null | undefined,
  tenantDefault: string | null | undefined
): string {
  const allowed = configuredCurrencies(currencies)
  const fallback = (tenantDefault ?? "").trim().toUpperCase()
  const defaultCurrency = allowed.includes(fallback) ? fallback : allowed[0]
  const value = (requested ?? "").trim().toUpperCase()
  if (!value) return defaultCurrency
  if (!allowed.includes(value)) {
    throw new Error("Currency must be one of the configured currencies")
  }
  return value
}

export function resolveAccountCurrencyBackfill(
  tenantDefault: string | null | undefined,
  currencies: readonly string[] | null | undefined
): string {
  if (!Array.isArray(currencies) || !currencies.length) return "MYR"
  const allowed = configuredCurrencies(currencies)
  const candidate = (tenantDefault ?? "").trim().toUpperCase()
  return allowed.includes(candidate) ? candidate : allowed[0] ?? "MYR"
}

export function resolveCurrencyOverride(
  requested: string | null | undefined,
  inheritedCurrency: string | null | undefined,
  currencies: readonly string[] | null | undefined,
  tenantDefault: string | null | undefined
): string {
  const explicit = (requested ?? "").trim()
  const inherited = (inheritedCurrency ?? "").trim().toUpperCase()
  if (explicit && explicit.toUpperCase() !== inherited) {
    return resolveConfiguredCurrency(explicit, currencies, tenantDefault)
  }
  const allowed = configuredCurrencies(currencies)
  return allowed.includes(inherited)
    ? inherited
    : resolveConfiguredCurrency(undefined, currencies, tenantDefault)
}

export function assertCurrencyLock(
  effectiveCurrency: string,
  currentCurrency: string,
  primaryQuotationCurrency: string | null | undefined
): void {
  if (
    primaryQuotationCurrency &&
    effectiveCurrency.toUpperCase() !== primaryQuotationCurrency.toUpperCase()
  ) {
    throw new Error(
      `Currency is locked while a primary quotation exists. Current ${currentCurrency} cannot change to ${effectiveCurrency}.`
    )
  }
}

async function tenantCurrencySettings(tx: Tx, tenantId: string) {
  const [settings] = await tx
    .select({
      currencies: tenantSettings.currencies,
      defaultCurrency: tenantSettings.defaultCurrency,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  return settings
}

export async function tenantConfiguredCurrency(
  tx: Tx,
  tenantId: string,
  requested: string | null | undefined
): Promise<string> {
  const settings = await tenantCurrencySettings(tx, tenantId)
  return resolveConfiguredCurrency(
    requested,
    settings?.currencies,
    settings?.defaultCurrency
  )
}

export async function tenantCurrencyForRecord(
  tx: Tx,
  tenantId: string,
  requested: string | null | undefined,
  inheritedCurrency: string | null | undefined
): Promise<string> {
  const settings = await tenantCurrencySettings(tx, tenantId)
  return resolveCurrencyOverride(
    requested,
    inheritedCurrency,
    settings?.currencies,
    settings?.defaultCurrency
  )
}

/**
 * The tenant's configured default currency (Settings → General; fallback MYR),
 * normalized to a 3-char upper code. Use as the currency fallback when creating
 * a record that carries no currency of its own, so the setting is authoritative
 * instead of a hardcoded "MYR". Call inside the record's own transaction.
 */
export async function tenantDefaultCurrency(
  tx: Tx,
  tenantId: string
): Promise<string> {
  return tenantConfiguredCurrency(tx, tenantId, undefined)
}
