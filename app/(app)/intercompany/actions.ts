"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import {
  intercompanyDeals,
  intercompanyDealResponses,
  organization,
  projects,
} from "@/db/schema"

export type IntercompanyResponseValue = "accepted" | "declined"

/**
 * One INBOUND intercompany deal: a deal a sibling entity owns and has assigned
 * to the current entity for delivery. Snapshotted by the origin's sync service
 * (server/services/intercompany.ts); this side only responds (accept/decline)
 * and may spin up a local delivery project.
 */
export type InboundIntercompanyDeal = {
  id: string
  /** The sibling entity that owns the deal (live org name; snapshot-free). */
  originEntityName: string | null
  name: string
  accountName: string | null
  currency: string
  estimatedAmount: string | null
  quotedAmount: string | null
  /** The ORIGIN's recognized cut (%); this entity's share is the remainder. */
  recognizedPercent: string | null
  status: string
  stageName: string | null
  expectedCloseDate: string | null
  projectYear: number | null
  updatedAt: Date
  /** This entity's handshake on the assignment, if any. */
  response: IntercompanyResponseValue | null
  responseReason: string | null
  respondedAt: Date | null
  /** Local delivery project created from this deal, if any. */
  projectId: string | null
  projectCode: string | null
}

/**
 * Deals other group entities have assigned to this entity for delivery.
 * RLS on intercompany_deals grants the partner side SELECT; the explicit
 * partner predicate keeps the intent readable (and excludes this entity's own
 * OUTBOUND mirrors, which the same policy would also let it read).
 */
export async function listInboundIntercompanyDeals(): Promise<
  InboundIntercompanyDeal[]
> {
  return withTenant(PERMISSIONS.INTERCOMPANY_VIEW, async (tx, ctx) => {
    const rows = await tx
      .select({
        id: intercompanyDeals.id,
        originEntityName: organization.name,
        name: intercompanyDeals.name,
        accountName: intercompanyDeals.accountName,
        currency: intercompanyDeals.currency,
        estimatedAmount: intercompanyDeals.estimatedAmount,
        quotedAmount: intercompanyDeals.quotedAmount,
        recognizedPercent: intercompanyDeals.recognizedPercent,
        status: intercompanyDeals.status,
        stageName: intercompanyDeals.stageName,
        expectedCloseDate: intercompanyDeals.expectedCloseDate,
        projectYear: intercompanyDeals.projectYear,
        updatedAt: intercompanyDeals.updatedAt,
        response: intercompanyDealResponses.response,
        responseReason: intercompanyDealResponses.reason,
        respondedAt: intercompanyDealResponses.respondedAt,
        projectId: projects.id,
        projectCode: projects.projectCode,
      })
      .from(intercompanyDeals)
      .leftJoin(organization, eq(intercompanyDeals.tenantId, organization.id))
      .leftJoin(
        intercompanyDealResponses,
        eq(intercompanyDealResponses.dealId, intercompanyDeals.id)
      )
      // Local delivery project (RLS scopes projects to this tenant, so only
      // OUR project can match).
      .leftJoin(
        projects,
        eq(projects.intercompanyDealId, intercompanyDeals.id)
      )
      .where(eq(intercompanyDeals.partnerTenantId, ctx.tenantId))
      .orderBy(desc(intercompanyDeals.updatedAt))
    return rows
  })
}

/**
 * Accept or decline an inbound intercompany assignment. One response per
 * deal; responding again overwrites (e.g. decline after a mistaken accept).
 * The origin entity sees the response on its funnel detail page.
 */
export async function respondToIntercompanyDeal(
  dealId: string,
  response: IntercompanyResponseValue,
  reason?: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.INTERCOMPANY_VIEW, async (tx, ctx) => {
      const [deal] = await tx
        .select({
          id: intercompanyDeals.id,
          originTenantId: intercompanyDeals.tenantId,
        })
        .from(intercompanyDeals)
        .where(
          and(
            eq(intercompanyDeals.id, dealId),
            eq(intercompanyDeals.partnerTenantId, ctx.tenantId)
          )
        )
        .limit(1)
      if (!deal)
        throw new Error("Deal not found or not assigned to this entity.")

      const trimmed = (reason ?? "").trim()
      if (response === "declined" && !trimmed) {
        throw new Error("A reason is required when declining.")
      }

      const values = {
        dealId: deal.id,
        tenantId: ctx.tenantId,
        originTenantId: deal.originTenantId,
        response,
        reason: trimmed || null,
        respondedByMemberId: ctx.memberId,
        respondedAt: new Date(),
        updatedAt: new Date(),
      }
      await tx
        .insert(intercompanyDealResponses)
        .values(values)
        .onConflictDoUpdate({
          target: intercompanyDealResponses.dealId,
          set: values,
        })

      await writeAudit(tx, ctx, {
        action: `intercompany.${response}`,
        entityType: "intercompany_deal",
        entityId: deal.id,
        after: { response, reason: trimmed || null },
      })
    })
    revalidatePath("/intercompany")
  })
}
