import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { tenantSettings } from "@/db/schema"
import { DEFAULT_CURRENCIES } from "@/lib/tenant-defaults"

export function configuredCurrencies(
  currencies: readonly string[] | null | undefined
): string[] {
  const values = Array.from(
    new Set(
      (currencies?.length ? currencies : DEFAULT_CURRENCIES)
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
  if (!currencies?.length) return "MYR"
  const allowed = configuredCurrencies(currencies)
  const candidate = (tenantDefault ?? "").trim().toUpperCase()
  return allowed.includes(candidate) ? candidate : allowed[0] ?? "MYR"
}

export function resolveOpportunityCurrency(
  requested: string | null | undefined,
  accountCurrency: string | null | undefined,
  currencies: readonly string[] | null | undefined,
  tenantDefault: string | null | undefined
): string {
  return resolveConfiguredCurrency(requested ?? accountCurrency, currencies, tenantDefault)
}

export function resolveQuotationCurrency(
  requested: string | null | undefined,
  funnelCurrency: string | null | undefined,
  currencies: readonly string[] | null | undefined,
  tenantDefault: string | null | undefined
): string {
  return resolveConfiguredCurrency(requested ?? funnelCurrency, currencies, tenantDefault)
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
