import "server-only"
import { eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { tenantSettings } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"

/**
 * Allocate the next quotation number using the tenant's configurable
 * prefix / sequence / padding, atomically incrementing the counter.
 * Call inside the same tx that inserts the quotation.
 */
export async function nextQuoteNumber(tx: Tx, ctx: ServerContext): Promise<string> {
  const [s] = await tx
    .update(tenantSettings)
    .set({ quoteNextNumber: sql`${tenantSettings.quoteNextNumber} + 1` })
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .returning({
      prefix: tenantSettings.quotePrefix,
      next: tenantSettings.quoteNextNumber,
      pad: tenantSettings.quotePadWidth,
    })
  const assigned = (s?.next ?? 1) - 1
  const prefix = s?.prefix ?? "Q-"
  const pad = s?.pad ?? 4
  return `${prefix}${String(assigned).padStart(pad, "0")}`
}

/**
 * Allocate the next project code: {YY}-{EntityCode}-{AccountCode}-{running}.
 * Increments the tenant's project counter atomically.
 */
export async function nextProjectCode(
  tx: Tx,
  ctx: ServerContext,
  accountCode: string
): Promise<string> {
  const [s] = await tx
    .update(tenantSettings)
    .set({ projectNextNumber: sql`${tenantSettings.projectNextNumber} + 1` })
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .returning({
      entityCode: tenantSettings.entityCode,
      next: tenantSettings.projectNextNumber,
      pad: tenantSettings.projectPadWidth,
    })
  const assigned = (s?.next ?? 1) - 1
  const entity = (s?.entityCode || "ENT").toUpperCase()
  const acct = (accountCode || "ACC").toUpperCase()
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0")
  const running = String(assigned).padStart(s?.pad ?? 3, "0")
  return `${yy}-${entity}-${acct}-${running}`
}
