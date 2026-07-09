"use server"

import { asc, desc, eq } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { paymentMilestones, funnels, quotations } from "@/db/schema"

export type PaymentMilestoneRow = typeof paymentMilestones.$inferSelect

/** A milestone row for the list, joined to its funnel + quotation for display. */
export type PaymentMilestoneListItem = PaymentMilestoneRow & {
  funnelName: string | null
  quoteNumber: string | null
}

/** A single milestone plus its resolved funnel name + quote number. */
export type PaymentMilestoneDetail = PaymentMilestoneRow & {
  funnelName: string | null
  quoteNumber: string | null
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
      })
      .from(paymentMilestones)
      .leftJoin(funnels, eq(paymentMilestones.funnelId, funnels.id))
      .leftJoin(quotations, eq(paymentMilestones.quotationId, quotations.id))
      .where(eq(paymentMilestones.id, id))
      .limit(1)
    if (!row) return null
    return {
      ...row.m,
      funnelName: row.funnelName,
      quoteNumber: row.quoteNumber,
    }
  })
}
