import "server-only"
import { and, asc, eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { opportunityProducts, quotationLineItems, products } from "@/db/schema"

/**
 * Mirrors Salesforce's synced-quote behaviour: a funnel's Quote Line Items
 * populate its Opportunity Products, and downstream automations (PIL /
 * milestone creation) read "quote line items OR opportunity products". Call
 * this whenever a quotation becomes the funnel's primary/synced quote (or
 * that primary quote is accepted) — right after `funnels.primaryQuotationId`
 * is updated, in the same transaction.
 *
 * One-way only: quote line items -> opportunity products. Never the reverse.
 * Delete-then-insert makes re-syncing idempotent — the funnel's existing
 * `opportunity_products` are fully replaced with the given quote's current
 * lines every time.
 */
export async function syncFunnelProductsFromQuote(
  tx: Tx,
  tenantId: string,
  funnelId: string,
  quotationId: string
): Promise<void> {
  await tx
    .delete(opportunityProducts)
    .where(
      and(
        eq(opportunityProducts.tenantId, tenantId),
        eq(opportunityProducts.funnelId, funnelId)
      )
    )

  const lines = await tx
    .select({
      productId: quotationLineItems.productId,
      description: quotationLineItems.description,
      quantity: quotationLineItems.quantity,
      unitPrice: quotationLineItems.unitPrice,
      lineTotal: quotationLineItems.lineTotal,
      uom: quotationLineItems.uom,
      sortOrder: quotationLineItems.sortOrder,
      // Line items don't carry their own category; fall back to the linked
      // catalog product's product-line code when the line references one.
      productCategory: products.productCode,
    })
    .from(quotationLineItems)
    .leftJoin(products, eq(quotationLineItems.productId, products.id))
    .where(
      and(
        eq(quotationLineItems.tenantId, tenantId),
        eq(quotationLineItems.quotationId, quotationId)
      )
    )
    .orderBy(asc(quotationLineItems.sortOrder))

  if (lines.length === 0) return

  await tx.insert(opportunityProducts).values(
    lines.map((line) => ({
      tenantId,
      funnelId,
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: line.lineTotal,
      uom: line.uom,
      productCategory: line.productCategory,
      sortOrder: line.sortOrder,
    }))
  )
}
