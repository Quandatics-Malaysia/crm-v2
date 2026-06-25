import "server-only"
import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { quotations, opportunities } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"

/**
 * Net (ex-tax) value of a quotation = subtotal − discount. This is the single
 * source of truth for a deal's value (tax is a pass-through, not revenue).
 */
export function quoteNet(q: {
  subtotal: string | null
  discountTotal: string | null
}): string {
  const net = Number(q.subtotal ?? 0) - Number(q.discountTotal ?? 0)
  return (Number.isFinite(net) ? net : 0).toFixed(2)
}

/**
 * Sync opportunities.amount to its primary quotation's net value. Call after
 * any change to which quote is primary, or to the primary quote's totals.
 * No-op when the opportunity has no primary quotation (the manual estimate
 * stays until a quote exists).
 */
export async function syncOpportunityAmount(
  tx: Tx,
  _ctx: ServerContext,
  opportunityId: string
): Promise<void> {
  const [opp] = await tx
    .select({ primaryQuotationId: opportunities.primaryQuotationId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1)
  if (!opp?.primaryQuotationId) return

  const [q] = await tx
    .select({
      subtotal: quotations.subtotal,
      discountTotal: quotations.discountTotal,
    })
    .from(quotations)
    .where(eq(quotations.id, opp.primaryQuotationId))
    .limit(1)
  if (!q) return

  await tx
    .update(opportunities)
    .set({ amount: quoteNet(q) })
    .where(eq(opportunities.id, opportunityId))
}

/** The current net value to use for an opportunity (primary quote net, else manual amount). */
export async function opportunityNetValue(
  tx: Tx,
  opportunityId: string
): Promise<{ value: string; fromQuoteId: string | null; quoteNumber: string | null }> {
  const [opp] = await tx
    .select({
      amount: opportunities.amount,
      primaryQuotationId: opportunities.primaryQuotationId,
    })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1)
  if (opp?.primaryQuotationId) {
    const [q] = await tx
      .select({
        subtotal: quotations.subtotal,
        discountTotal: quotations.discountTotal,
        quoteNumber: quotations.quoteNumber,
      })
      .from(quotations)
      .where(eq(quotations.id, opp.primaryQuotationId))
      .limit(1)
    if (q)
      return {
        value: quoteNet(q),
        fromQuoteId: opp.primaryQuotationId,
        quoteNumber: q.quoteNumber,
      }
  }
  return { value: opp?.amount ?? "0", fromQuoteId: null, quoteNumber: null }
}
