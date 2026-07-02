import "server-only"
import { and, eq, isNull, notInArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { quotations, opportunities } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"
import { syncIntercompanyMirror } from "./intercompany"

/**
 * Quote statuses that must never drive an opportunity's value/forecast: a
 * deleted, rejected, expired or voided proposal is not a live commitment.
 */
const NON_VALUE_QUOTE_STATUS: ("rejected" | "expired" | "void")[] = [
  "rejected",
  "expired",
  "void",
]

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
  if (opp?.primaryQuotationId) {
    const [q] = await tx
      .select({
        subtotal: quotations.subtotal,
        discountTotal: quotations.discountTotal,
      })
      .from(quotations)
      .where(
        and(
          eq(quotations.id, opp.primaryQuotationId),
          isNull(quotations.deletedAt),
          notInArray(quotations.status, NON_VALUE_QUOTE_STATUS)
        )
      )
      .limit(1)
    if (q) {
      await tx
        .update(opportunities)
        .set({ amount: quoteNet(q) })
        .where(eq(opportunities.id, opportunityId))
    }
  }
  // Every quote-driven value change funnels through here, so this is the one
  // choke point that keeps the partner-facing intercompany mirror's quoted
  // amount aligned. No-op for non-intercompany deals.
  await syncIntercompanyMirror(tx, opportunityId)
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
      .where(
        and(
          eq(quotations.id, opp.primaryQuotationId),
          isNull(quotations.deletedAt),
          notInArray(quotations.status, NON_VALUE_QUOTE_STATUS)
        )
      )
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
