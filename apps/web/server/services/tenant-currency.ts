import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { tenantSettings } from "@/db/schema"

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
  const [s] = await tx
    .select({ currency: tenantSettings.defaultCurrency })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)
  return (s?.currency || "MYR").toUpperCase().slice(0, 3)
}
