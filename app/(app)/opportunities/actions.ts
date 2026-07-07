"use server"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
} from "@/lib/access-scope"
import { opportunities, funnels, accounts, member, user } from "@/db/schema"

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
  accountName: string
  ownerName: string | null
  funnels: {
    id: string
    name: string
    stageName: string | null
    status: string
    estimatedAmount: string | null
    currency: string
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
      })
      .from(funnels)
      .where(
        and(eq(funnels.opportunityId, id), isNull(funnels.deletedAt))
      )
      .orderBy(desc(funnels.createdAt))

    return {
      opportunity: opp,
      accountName: acct?.name ?? "—",
      ownerName: owner?.name ?? null,
      funnels: children.map((c) => ({ ...c, stageName: null })),
    }
  })
}
