"use server"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
} from "@/lib/access-scope"
import {
  opportunities,
  funnels,
  pipelineStages,
  quotations,
  opportunityProducts,
  accounts,
  member,
  user,
} from "@/db/schema"

export type OpportunityContainerRow = {
  id: string
  code: string
  name: string
  accountId: string
  accountName: string
  ownerName: string | null
  totalEstimatedFunnelAmount: string | null
  funnelCount: number
  currency: string
  createdAt: Date
}

/** All Opportunity containers visible to the caller, with funnel counts. */
export async function listOpportunities(): Promise<OpportunityContainerRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: opportunities.id,
        code: opportunities.code,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
        ownerName: user.name,
        totalEstimatedFunnelAmount: opportunities.totalEstimatedFunnelAmount,
        currency: opportunities.currency,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(opportunities.accountId, accounts.id))
      .leftJoin(member, eq(opportunities.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(
        and(
          isNull(opportunities.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(desc(opportunities.createdAt))

    if (rows.length === 0) return []
    const counts = await tx
      .select({
        opportunityId: funnels.opportunityId,
        n: sql<number>`count(*)::int`,
      })
      .from(funnels)
      .where(
        and(
          isNull(funnels.deletedAt),
          inArray(
            funnels.opportunityId,
            rows.map((r) => r.id)
          )
        )
      )
      .groupBy(funnels.opportunityId)
    const countBy = new Map(counts.map((c) => [c.opportunityId, c.n]))
    return rows.map((r) => ({ ...r, funnelCount: countBy.get(r.id) ?? 0 }))
  })
}

export type OpportunityContainerDetail = {
  opportunity: typeof opportunities.$inferSelect
  accountId: string
  accountName: string
  ownerName: string | null
  funnels: {
    id: string
    name: string
    stageName: string | null
    stageKind: string | null
    status: string
    estimatedAmount: string | null
    currency: string
  }[]
  quotations: {
    id: string
    quoteNumber: string
    status: string
    total: string | null
    currency: string
    funnelId: string
    funnelName: string
  }[]
  products: {
    id: string
    description: string | null
    quantity: string
    unitPrice: string
    productCategory: string | null
    funnelId: string
    funnelName: string
  }[]
}

/** One Opportunity container with its child funnels. */
export async function getOpportunity(
  id: string
): Promise<OpportunityContainerDetail | null> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .limit(1)
    if (!opp) return null
    if (!ownsOrManages(visible, opp.ownerMemberId)) return null

    const [acct] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, opp.accountId))
      .limit(1)
    const [owner] = await tx
      .select({ name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.id, opp.ownerMemberId))
      .limit(1)

    const children = await tx
      .select({
        id: funnels.id,
        name: funnels.name,
        status: funnels.status,
        estimatedAmount: funnels.estimatedAmount,
        currency: funnels.currency,
        stageName: pipelineStages.name,
        stageKind: pipelineStages.kind,
      })
      .from(funnels)
      .leftJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
      .where(
        and(eq(funnels.opportunityId, id), isNull(funnels.deletedAt))
      )
      .orderBy(desc(funnels.createdAt))

    const funnelIds = children.map((c) => c.id)
    const funnelName = new Map(children.map((c) => [c.id, c.name]))

    // Quotations + products roll up from ALL funnels under this opportunity.
    const quotes = funnelIds.length
      ? await tx
          .select({
            id: quotations.id,
            quoteNumber: quotations.quoteNumber,
            status: quotations.status,
            total: quotations.total,
            currency: quotations.currency,
            funnelId: quotations.funnelId,
          })
          .from(quotations)
          .where(
            and(inArray(quotations.funnelId, funnelIds), isNull(quotations.deletedAt))
          )
          .orderBy(desc(quotations.createdAt))
      : []

    const prods = funnelIds.length
      ? await tx
          .select({
            id: opportunityProducts.id,
            description: opportunityProducts.description,
            quantity: opportunityProducts.quantity,
            unitPrice: opportunityProducts.unitPrice,
            productCategory: opportunityProducts.productCategory,
            funnelId: opportunityProducts.funnelId,
          })
          .from(opportunityProducts)
          .where(inArray(opportunityProducts.funnelId, funnelIds))
          .orderBy(desc(opportunityProducts.createdAt))
      : []

    return {
      opportunity: opp,
      accountId: opp.accountId,
      accountName: acct?.name ?? "—",
      ownerName: owner?.name ?? null,
      funnels: children,
      quotations: quotes.map((q) => ({
        ...q,
        funnelName: funnelName.get(q.funnelId) ?? "—",
      })),
      products: prods.map((p) => ({
        ...p,
        funnelName: funnelName.get(p.funnelId) ?? "—",
      })),
    }
  })
}
