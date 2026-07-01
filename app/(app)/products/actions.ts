"use server"

import { revalidatePath } from "next/cache"
import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { writeAudit } from "@/server/audit"
import { runAction, type ActionResult } from "@/lib/action-result"
import { visibleMemberIds, ownerScope } from "@/lib/access-scope"
import {
  products,
  quotations,
  quotationLineItems,
  opportunities,
} from "@/db/schema"

/** Largest page we ever return from a list endpoint. */
const LIST_LIMIT = 1000

export type ProductRow = typeof products.$inferSelect

export type ProductInput = {
  name: string
  productCode?: string | null
  subcategory?: string | null
  uom?: string | null
  currency?: string | null
  standardPrice?: string | null
  description?: string | null
  isActive?: boolean
}

function clean(v?: string | null): string | null {
  const t = (v ?? "").trim()
  return t.length ? t : null
}

/** Normalize a money string to a fixed 2dp value; rejects negatives/NaN. */
function normalizePrice(v?: string | null): string {
  const n = Number((v ?? "").toString().trim() || "0")
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid price")
  return n.toFixed(2)
}

/** All non-deleted products in the tenant, by name. */
export async function listProducts(): Promise<ProductRow[]> {
  return withTenant(PERMISSIONS.PRODUCT_VIEW, async (tx, ctx) => {
    return tx
      .select()
      .from(products)
      .where(
        and(eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt))
      )
      .orderBy(asc(products.name))
      .limit(LIST_LIMIT)
  })
}

export async function getProduct(id: string): Promise<ProductRow | null> {
  return withTenant(PERMISSIONS.PRODUCT_VIEW, async (tx) => {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .limit(1)
    return row ?? null
  })
}

export type ProductUsageRow = {
  quotationId: string
  quoteNumber: string
  status: string
  total: string
  currency: string
  /** The funnel this quote belongs to — so the product page shows where it's used. */
  opportunityId: string
  funnelName: string
}

/**
 * Quotations whose line items reference this product ("where used"), newest
 * first, scoped to what the caller can see. Powers the product detail page's
 * "Used in quotes" tab.
 */
export async function listProductUsage(
  productId: string
): Promise<ProductUsageRow[]> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .selectDistinct({
        quotationId: quotations.id,
        quoteNumber: quotations.quoteNumber,
        status: quotations.status,
        total: quotations.total,
        currency: quotations.currency,
        createdAt: quotations.createdAt,
        opportunityId: opportunities.id,
        funnelName: opportunities.name,
      })
      .from(quotationLineItems)
      .innerJoin(
        quotations,
        eq(quotationLineItems.quotationId, quotations.id)
      )
      .innerJoin(opportunities, eq(quotations.opportunityId, opportunities.id))
      .where(
        and(
          eq(quotationLineItems.productId, productId),
          isNull(quotations.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(desc(quotations.createdAt))
      .limit(LIST_LIMIT)
    return rows.map((r) => ({
      quotationId: r.quotationId,
      quoteNumber: r.quoteNumber,
      status: r.status,
      total: r.total,
      currency: r.currency,
      opportunityId: r.opportunityId,
      funnelName: r.funnelName,
    }))
  })
}

export async function createProduct(
  input: ProductInput
): Promise<ActionResult<ProductRow>> {
  return runAction(async () => {
    if (!input.name?.trim()) throw new Error("Name is required")
    const standardPrice = normalizePrice(input.standardPrice)

    const row = await withTenant(PERMISSIONS.PRODUCT_CREATE, async (tx, ctx) => {
      const [created] = await tx
        .insert(products)
        .values({
          tenantId: ctx.tenantId,
          name: input.name.trim(),
          productCode: clean(input.productCode),
          subcategory: clean(input.subcategory),
          uom: clean(input.uom),
          currency: (clean(input.currency) ?? "MYR").toUpperCase().slice(0, 3),
          standardPrice,
          description: clean(input.description),
          isActive: input.isActive ?? true,
        })
        .returning()
      await writeAudit(tx, ctx, {
        action: "product.created",
        entityType: "product",
        entityId: created.id,
        after: created,
      })
      return created
    })
    revalidatePath("/products")
    return row
  })
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<ProductRow>> {
  return runAction(async () => {
    if (!input.name?.trim()) throw new Error("Name is required")
    const standardPrice = normalizePrice(input.standardPrice)

    const row = await withTenant(PERMISSIONS.PRODUCT_UPDATE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), isNull(products.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Product not found")

      const [updated] = await tx
        .update(products)
        .set({
          name: input.name.trim(),
          productCode: clean(input.productCode),
          subcategory: clean(input.subcategory),
          uom: clean(input.uom),
          currency: (clean(input.currency) ?? "MYR").toUpperCase().slice(0, 3),
          standardPrice,
          description: clean(input.description),
          isActive: input.isActive ?? true,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning()
      await writeAudit(tx, ctx, {
        action: "product.updated",
        entityType: "product",
        entityId: id,
        before,
        after: updated,
      })
      return updated
    })
    revalidatePath("/products")
    revalidatePath(`/products/${id}`)
    return row
  })
}

export async function deleteProduct(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PRODUCT_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, id), isNull(products.deletedAt)))
        .limit(1)
      if (!before) throw new Error("Product not found")
      await tx
        .update(products)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(products.id, id))
      await writeAudit(tx, ctx, {
        action: "product.deleted",
        entityType: "product",
        entityId: id,
        before,
      })
    })
    revalidatePath("/products")
  })
}

/** Reverse a soft-delete (undo). */
export async function restoreProduct(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PRODUCT_DELETE, async (tx, ctx) => {
      const [before] = await tx
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1)
      if (!before) throw new Error("Product not found")
      if (!before.deletedAt) return
      await tx
        .update(products)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(products.id, id))
      await writeAudit(tx, ctx, {
        action: "product.restored",
        entityType: "product",
        entityId: id,
        after: before,
      })
    })
    revalidatePath("/products")
  })
}
