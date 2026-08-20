"use server"

import { and, asc, desc, eq, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, type Tx } from "@/lib/actions"
import type { ServerContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import {
  paymentMilestones,
  paymentMilestoneStatus,
  funnels,
  quotations,
  quotationLineItems,
  products,
  opportunities,
} from "@/db/schema"
import { runAction, type ActionResult } from "@/lib/action-result"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { logActivity } from "@/server/services/activity"
import { writeAudit } from "@/server/audit"
import { opportunityNetValue } from "@/server/services/value"
import { milestoneName } from "@/lib/so-milestones"
import {
  canTransitionPaymentMilestone,
  type PaymentMilestoneStatus,
} from "@/lib/payment-milestone-lifecycle"

export type PaymentMilestoneRow = typeof paymentMilestones.$inferSelect

/** A milestone row for the list, joined to its funnel + quotation for display. */
export type PaymentMilestoneListItem = PaymentMilestoneRow & {
  funnelName: string | null
  quoteNumber: string | null
  quoteStatus: string | null
}

/** A single milestone plus its resolved funnel name + quote number. */
export type PaymentMilestoneDetail = PaymentMilestoneRow & {
  funnelName: string | null
  quoteNumber: string | null
  quoteStatus: string | null
  quoteTotal: string | null
  quoteCurrency: string | null
}

/** Resolve product metadata from the quotation line that owns the milestone.
 * A legacy/default full-payment milestone has no line-item foreign key, so a
 * single-line quotation is unambiguous; multi-line milestones remain blank
 * until the data model can identify their source line. */
async function resolveMilestoneProduct(
  tx: Tx,
  quotationId: string | null,
  milestoneTitle: string
): Promise<{ productCategory: string | null; productSubcategory: string | null }> {
  if (!quotationId) return { productCategory: null, productSubcategory: null }
  const lines = await tx
    .select({
      description: quotationLineItems.description,
      productName: products.name,
      productCategory: products.productCode,
      productSubcategory: products.subcategory,
    })
    .from(quotationLineItems)
    .leftJoin(products, eq(quotationLineItems.productId, products.id))
    .where(eq(quotationLineItems.quotationId, quotationId))
    .orderBy(asc(quotationLineItems.sortOrder))
  const line =
    lines.find(
      (candidate) =>
        candidate.description === milestoneTitle ||
        candidate.productName === milestoneTitle
    ) ?? (lines.length === 1 ? lines[0] : null)
  return {
    productCategory: line?.productCategory ?? null,
    productSubcategory: line?.productSubcategory ?? null,
  }
}

/**
 * All tenant payment milestones (RLS-scoped), joined to their funnel name and
 * quotation number for display, newest first.
 */
export async function listPaymentMilestones(): Promise<
  PaymentMilestoneListItem[]
> {
  return withTenant(PERMISSIONS.PAYMENT_MILESTONE_VIEW, async (tx) => {
    const rows = await tx
      .select({
        m: paymentMilestones,
        funnelName: funnels.name,
        quoteNumber: quotations.quoteNumber,
        quoteStatus: quotations.status,
      })
      .from(paymentMilestones)
      .leftJoin(funnels, eq(paymentMilestones.funnelId, funnels.id))
      .leftJoin(quotations, eq(paymentMilestones.quotationId, quotations.id))
      .orderBy(desc(paymentMilestones.createdAt))
      .limit(500)
    return rows.map((r) => ({
      ...r.m,
      funnelName: r.funnelName,
      quoteNumber: r.quoteNumber,
      quoteStatus: r.quoteStatus,
    }))
  })
}

/**
 * Payment milestones attached to a funnel, ordered by their sort order then
 * creation time. Used by the funnel detail related tab.
 */
export async function listFunnelMilestones(
  funnelId: string
): Promise<PaymentMilestoneRow[]> {
  return withTenant(PERMISSIONS.PAYMENT_MILESTONE_VIEW, async (tx) => {
    return tx
      .select()
      .from(paymentMilestones)
      .where(eq(paymentMilestones.funnelId, funnelId))
      .orderBy(
        asc(paymentMilestones.sortOrder),
        asc(paymentMilestones.createdAt)
      )
  })
}

/** One milestone plus its resolved funnel name + quote number, or null. */
export async function getPaymentMilestone(
  id: string
): Promise<PaymentMilestoneDetail | null> {
  return withTenant(PERMISSIONS.PAYMENT_MILESTONE_VIEW, async (tx) => {
    const [row] = await tx
      .select({
        m: paymentMilestones,
        funnelName: funnels.name,
        quoteNumber: quotations.quoteNumber,
        quoteStatus: quotations.status,
        quoteTotal: quotations.total,
        quoteCurrency: quotations.currency,
      })
      .from(paymentMilestones)
      .leftJoin(funnels, eq(paymentMilestones.funnelId, funnels.id))
      .leftJoin(quotations, eq(paymentMilestones.quotationId, quotations.id))
      .where(eq(paymentMilestones.id, id))
      .limit(1)
    if (!row) return null
    const product = await resolveMilestoneProduct(tx, row.m.quotationId, row.m.title)
    return {
      ...row.m,
      funnelName: row.funnelName,
      quoteNumber: row.quoteNumber,
      quoteStatus: row.quoteStatus,
      quoteTotal: row.quoteTotal,
      quoteCurrency: row.quoteCurrency,
      ...product,
    }
  })
}

// ── Funnel-scoped milestone CRUD (core; independent of the Projects module) ──
// Mirrors app/(app)/projects/actions.ts's create/update/delete/reorderMilestone
// functions, but reconciles against the FUNNEL's net value (opportunityNetValue)
// and scopes ownership via funnels.ownerMemberId instead of projects.

export type FunnelMilestoneCreateInput = {
  funnelId: string
  title: string
  description?: string | null
  amount?: string | null
  dueDate?: string | null
}

export type FunnelMilestoneUpdateInput = {
  title?: string
  description?: string | null
  amount?: string | null
  dueDate?: string | null
  soNumber?: string | null
  status?: string
}

type MilestoneStatusValue = PaymentMilestoneStatus

function isMilestoneStatus(v: string | undefined): v is MilestoneStatusValue {
  return (
    !!v && (paymentMilestoneStatus.enumValues as readonly string[]).includes(v)
  )
}

/** Whole-cent comparison to avoid float drift when reconciling money. */
const cents = (n: number) => Math.round(n * 100)

/** Sum of milestone amounts for a funnel, optionally excluding one milestone. */
async function funnelAllocatedTotal(
  tx: Tx,
  funnelId: string,
  excludeId?: string
): Promise<number> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${paymentMilestones.amount}), 0)`,
    })
    .from(paymentMilestones)
    .where(
      excludeId
        ? and(
            eq(paymentMilestones.funnelId, funnelId),
            ne(paymentMilestones.id, excludeId)
          )
        : eq(paymentMilestones.funnelId, funnelId)
    )
  return Number(row?.total ?? 0)
}

/**
 * Auto-create ONE "Full Payment" milestone at the funnel's full net value,
 * but only when it currently has zero milestones — called right after a
 * quote becomes primary/synced ("itemised into the quotation by default").
 * Never fires destructively: once any milestone exists (manually added,
 * auto-created, or split), a quote re-sync never touches it again. No-op
 * when the funnel has no resolvable net value yet. Runs inside the caller's
 * own tenant transaction — assumes the caller already authorized the
 * funnel-level mutation (e.g. QUOTATION_UPDATE), so it does its own
 * permission check.
 */
export async function seedDefaultFunnelMilestone(
  tx: Tx,
  ctx: ServerContext,
  funnelId: string
): Promise<void> {
  const [existing] = await tx
    .select({ id: paymentMilestones.id })
    .from(paymentMilestones)
    .where(eq(paymentMilestones.funnelId, funnelId))
    .limit(1)
  if (existing) return

  const { value: netValue } = await opportunityNetValue(tx, funnelId)
  const amount = Number(netValue) || 0
  if (amount <= 0) return

  const [funnel] = await tx
    .select({
      primaryQuotationId: funnels.primaryQuotationId,
      quoteNumber: quotations.quoteNumber,
      projectCode: opportunities.projectCode,
    })
    .from(funnels)
    .leftJoin(opportunities, eq(funnels.opportunityId, opportunities.id))
    .leftJoin(quotations, eq(funnels.primaryQuotationId, quotations.id))
    .where(eq(funnels.id, funnelId))
    .limit(1)
  if (!funnel) return

  const title = funnel.quoteNumber
    ? `${funnel.quoteNumber} · Full payment`
    : "Full Payment"
  const [row] = await tx
    .insert(paymentMilestones)
    .values({
      tenantId: ctx.tenantId,
      funnelId,
      quotationId: funnel.primaryQuotationId,
      title,
      name: milestoneName(funnel.projectCode, title),
      amount: netValue,
      sortOrder: 0,
    })
    .returning({ id: paymentMilestones.id })

  await logActivity(tx, ctx, {
    entityType: "opportunity",
    entityId: funnelId,
    type: "system",
    subject: `Milestone added: ${title}`,
  })
  await writeAudit(tx, ctx, {
    action: "milestone.created",
    entityType: "opportunity",
    entityId: funnelId,
    after: { milestoneId: row.id, title, amount: netValue },
  })
}

export async function createFunnelMilestone(
  input: FunnelMilestoneCreateInput
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const created = await withTenant(
      PERMISSIONS.PAYMENT_MILESTONE_MANAGE,
      async (tx, ctx) => {
        // Lock the funnel row so concurrent milestone writes serialize against
        // the reconciliation check below (same guard as the project version).
        const [funnel] = await tx
          .select({
            ownerMemberId: funnels.ownerMemberId,
            primaryQuotationId: funnels.primaryQuotationId,
            projectCode: opportunities.projectCode,
          })
          .from(funnels)
          .leftJoin(opportunities, eq(funnels.opportunityId, opportunities.id))
          .where(eq(funnels.id, input.funnelId))
          .limit(1)
          .for("update", { of: funnels })
        if (!funnel) throw new Error("Funnel not found")

        const visible = await visibleMemberIds(tx, ctx)
        if (
          !canManageAllRecords(ctx) &&
          !ownsOrManages(visible, funnel.ownerMemberId)
        ) {
          throw new Error("FORBIDDEN: not permitted on this Funnel")
        }

        const title = input.title.trim()
        if (!title) throw new Error("Title is required")

        const { value: netValue } = await opportunityNetValue(tx, input.funnelId)
        const funnelValue = Number(netValue) || 0
        // Milestones are split by exact amount.
        const amount = input.amount != null && input.amount !== "" ? input.amount : "0"

        // Reconciliation: total milestone amounts may not exceed the funnel's
        // net value. Skipped when no value. Only block when this addition
        // actually pushes the total higher, mirroring the project version.
        if (funnelValue > 0) {
          const existingTotal = await funnelAllocatedTotal(tx, input.funnelId)
          const newTotal = existingTotal + Number(amount)
          if (
            cents(newTotal) > cents(funnelValue) &&
            cents(newTotal) > cents(existingTotal)
          ) {
            throw new Error(
              "Milestones would exceed the funnel value. Lower the amount or adjust other milestones."
            )
          }
        }

        const [{ maxSort }] = await tx
          .select({
            maxSort: sql<number>`coalesce(max(${paymentMilestones.sortOrder}), -1)`,
          })
          .from(paymentMilestones)
          .where(eq(paymentMilestones.funnelId, input.funnelId))

        const [row] = await tx
          .insert(paymentMilestones)
          .values({
            tenantId: ctx.tenantId,
            funnelId: input.funnelId,
            quotationId: funnel.primaryQuotationId,
            title,
            name: milestoneName(funnel.projectCode, title),
            description: input.description || null,
            amount,
            dueDate: input.dueDate || null,
            sortOrder: Number(maxSort) + 1,
          })
          .returning({ id: paymentMilestones.id })

        await logActivity(tx, ctx, {
          entityType: "opportunity",
          entityId: input.funnelId,
          type: "system",
          subject: `Milestone added: ${title}`,
        })

        await writeAudit(tx, ctx, {
          action: "milestone.created",
          entityType: "opportunity",
          entityId: input.funnelId,
          after: { milestoneId: row.id, title, amount },
        })
        return row
      }
    )
    revalidatePath(`/funnel/${input.funnelId}`)
    revalidatePath("/payment-milestones")
    return created
  })
}

export async function updateFunnelMilestone(
  id: string,
  input: FunnelMilestoneUpdateInput
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const funnelId = await withTenant(
      PERMISSIONS.PAYMENT_MILESTONE_MANAGE,
      async (tx, ctx) => {
        const [existing] = await tx
          .select()
          .from(paymentMilestones)
          .where(eq(paymentMilestones.id, id))
          .limit(1)
        if (!existing || !existing.funnelId) throw new Error("Milestone not found")

        // Lock the funnel row so concurrent milestone writes serialize against
        // the reconciliation check below (same guard as createFunnelMilestone).
        const [funnel] = await tx
          .select({ ownerMemberId: funnels.ownerMemberId })
          .from(funnels)
          .where(eq(funnels.id, existing.funnelId))
          .limit(1)
          .for("update")

        const visible = await visibleMemberIds(tx, ctx)
        if (
          !canManageAllRecords(ctx) &&
          !ownsOrManages(visible, funnel?.ownerMemberId ?? null)
        ) {
          throw new Error("FORBIDDEN: not permitted on this Funnel")
        }

        const { value: netValue } = await opportunityNetValue(tx, existing.funnelId)
        const funnelValue = Number(netValue) || 0

        // Milestones are split by exact amount; an untouched amount is preserved.
        const nextAmount =
          input.amount === undefined
            ? existing.amount
            : input.amount
              ? input.amount
              : "0"

        // Reconciliation: block edits that push the milestone total over the
        // funnel value. Edits that don't raise the total are always allowed.
        if (funnelValue > 0) {
          const otherTotal = await funnelAllocatedTotal(tx, existing.funnelId, id)
          const newTotal = otherTotal + Number(nextAmount)
          const oldTotal = otherTotal + Number(existing.amount)
          if (
            cents(newTotal) > cents(funnelValue) &&
            cents(newTotal) > cents(oldTotal)
          ) {
            throw new Error(
              "Milestones would exceed the funnel value. Lower the amount or adjust other milestones."
            )
          }
        }

        const nextStatus = isMilestoneStatus(input.status)
          ? input.status
          : existing.status
        // Only Won → Invoiced is a user-controlled transition. Closed Won
        // propagation is owned by the stage service and may set live rows Won.
        if (
          nextStatus !== existing.status &&
          !canTransitionPaymentMilestone(existing.status, nextStatus)
        ) {
          throw new Error("Milestone status cannot move backward.")
        }
        const nextTitle =
          input.title === undefined
            ? existing.title
            : input.title.trim() || existing.title

        await tx
          .update(paymentMilestones)
          .set({
            title: nextTitle,
            description:
              input.description === undefined
                ? existing.description
                : input.description || null,
            amount: nextAmount,
            dueDate:
              input.dueDate === undefined
                ? existing.dueDate
                : input.dueDate || null,
            soNumber:
              input.soNumber === undefined
                ? existing.soNumber
                : input.soNumber || null,
            status: nextStatus,
            updatedAt: new Date(),
          })
          .where(eq(paymentMilestones.id, id))

        await logActivity(tx, ctx, {
          entityType: "opportunity",
          entityId: existing.funnelId,
          type: "system",
          subject:
            nextStatus !== existing.status
              ? `Milestone ${nextTitle} marked ${nextStatus}`
              : `Milestone updated: ${nextTitle}`,
        })

        await writeAudit(tx, ctx, {
          action: "milestone.updated",
          entityType: "opportunity",
          entityId: existing.funnelId,
          before: { amount: existing.amount, status: existing.status },
          after: { milestoneId: id, amount: nextAmount, status: nextStatus },
        })

        return existing.funnelId
      }
    )
    revalidatePath(`/funnel/${funnelId}`)
    revalidatePath("/payment-milestones")
  })
}

export async function deleteFunnelMilestone(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const funnelId = await withTenant(
      PERMISSIONS.PAYMENT_MILESTONE_MANAGE,
      async (tx, ctx) => {
        const [milestone] = await tx
          .select({ funnelId: paymentMilestones.funnelId })
          .from(paymentMilestones)
          .where(eq(paymentMilestones.id, id))
          .limit(1)
        if (!milestone || !milestone.funnelId) throw new Error("Milestone not found")

        const [funnel] = await tx
          .select({ ownerMemberId: funnels.ownerMemberId })
          .from(funnels)
          .where(eq(funnels.id, milestone.funnelId))
          .limit(1)
        const visible = await visibleMemberIds(tx, ctx)
        if (
          !canManageAllRecords(ctx) &&
          !ownsOrManages(visible, funnel?.ownerMemberId ?? null)
        ) {
          throw new Error("FORBIDDEN: not permitted on this Funnel")
        }

        const [deleted] = await tx
          .delete(paymentMilestones)
          .where(eq(paymentMilestones.id, id))
          .returning({
            funnelId: paymentMilestones.funnelId,
            title: paymentMilestones.title,
          })
        if (!deleted) throw new Error("Milestone not found")

        await logActivity(tx, ctx, {
          entityType: "opportunity",
          entityId: deleted.funnelId ?? "",
          type: "system",
          subject: `Milestone deleted: ${deleted.title}`,
        })

        await writeAudit(tx, ctx, {
          action: "milestone.deleted",
          entityType: "opportunity",
          entityId: deleted.funnelId ?? "",
          before: { milestoneId: id, title: deleted.title },
        })

        return deleted.funnelId ?? ""
      }
    )
    revalidatePath(`/funnel/${funnelId}`)
    revalidatePath("/payment-milestones")
  })
}

/**
 * Persist a new milestone ordering. `order` is milestone ids in the desired
 * sequence; sortOrder is rewritten to match the index. Scoped to the funnel
 * (and tenant via RLS) so only this funnel's milestones are touched.
 */
export async function reorderFunnelMilestones(
  funnelId: string,
  order: string[]
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PAYMENT_MILESTONE_MANAGE, async (tx, ctx) => {
      const [funnel] = await tx
        .select({ ownerMemberId: funnels.ownerMemberId })
        .from(funnels)
        .where(eq(funnels.id, funnelId))
        .limit(1)
      if (!funnel) throw new Error("Funnel not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, funnel.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this Funnel")
      }

      for (let i = 0; i < order.length; i++) {
        await tx
          .update(paymentMilestones)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(paymentMilestones.id, order[i]),
              eq(paymentMilestones.funnelId, funnelId)
            )
          )
      }

      await writeAudit(tx, ctx, {
        action: "milestone.reordered",
        entityType: "opportunity",
        entityId: funnelId,
        after: { order },
      })
    })
    revalidatePath(`/funnel/${funnelId}`)
    revalidatePath("/payment-milestones")
  })
}

export type SplitMilestonePart = {
  title: string
  description?: string | null
  amount: string
  dueDate?: string | null
}

/**
 * Guided split: replace the funnel's current milestone(s) with N parts whose
 * amounts sum EXACTLY to the funnel's net quoted value — no partial commit.
 * "Never make it splitable" if it wouldn't reconcile: the caller (UI) only
 * offers this when the funnel is in its default, unsplit state, but the
 * exact-sum check here is the actual enforcement.
 */
export async function splitFunnelMilestones(
  funnelId: string,
  parts: SplitMilestonePart[]
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.PAYMENT_MILESTONE_MANAGE, async (tx, ctx) => {
      if (parts.length < 2) {
        throw new Error("Split into at least 2 parts.")
      }
      for (const p of parts) {
        if (!p.title.trim()) throw new Error("Every part needs a title.")
      }

      const [funnel] = await tx
        .select({
          ownerMemberId: funnels.ownerMemberId,
          primaryQuotationId: funnels.primaryQuotationId,
          projectCode: opportunities.projectCode,
        })
        .from(funnels)
        .leftJoin(opportunities, eq(funnels.opportunityId, opportunities.id))
        .where(eq(funnels.id, funnelId))
        .limit(1)
        .for("update", { of: funnels })
      if (!funnel) throw new Error("Funnel not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, funnel.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this Funnel")
      }

      const { value: netValue } = await opportunityNetValue(tx, funnelId)
      const target = Number(netValue) || 0
      const sum = parts.reduce((n, p) => n + Number(p.amount || 0), 0)
      if (cents(sum) !== cents(target)) {
        throw new Error(
          `Parts must sum to exactly ${netValue} — they currently sum to ${sum.toFixed(2)}.`
        )
      }

      await tx.delete(paymentMilestones).where(eq(paymentMilestones.funnelId, funnelId))

      const rows = parts.map((p, i) => ({
        tenantId: ctx.tenantId,
        funnelId,
        quotationId: funnel.primaryQuotationId,
        title: p.title.trim(),
        name: milestoneName(funnel.projectCode, p.title.trim()),
        description: p.description || null,
        amount: p.amount,
        dueDate: p.dueDate || null,
        sortOrder: i,
      }))
      await tx.insert(paymentMilestones).values(rows)

      await writeAudit(tx, ctx, {
        action: "milestone.split",
        entityType: "opportunity",
        entityId: funnelId,
        after: { parts: rows.length, sum },
      })
      await logActivity(tx, ctx, {
        entityType: "opportunity",
        entityId: funnelId,
        type: "system",
        subject: `Payment split into ${rows.length} milestones`,
      })
    })
    revalidatePath(`/funnel/${funnelId}`)
    revalidatePath("/payment-milestones")
  })
}
