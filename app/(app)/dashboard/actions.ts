import "server-only"
import { and, eq, isNull, lte, asc, sql } from "drizzle-orm"
import { requireContext } from "@/lib/server-context"
import { runInTenant } from "@/db"
import { stageApprovalRequests, opportunities, activities } from "@/db/schema"

export type PendingApproval = {
  id: string
  opportunityId: string
  opportunityName: string
  reason: string
  requestedAt: Date
}

export type FollowUpDue = {
  id: string
  subject: string
  entityType: string
  entityId: string
  dueAt: Date
}

export type FunnelMissingSo = {
  id: string
  name: string
  amount: string | null
  closedAt: Date | null
}

export type OpenPipeline = {
  count: number
  total: string
}

export type DashboardData = {
  myPendingApprovals: PendingApproval[]
  followUpsDue: FollowUpDue[]
  funnelsMissingSo: FunnelMissingSo[]
  myOpenPipeline: OpenPipeline
}

/**
 * Build the actionable dashboard lists for the current member: approvals
 * awaiting their decision, follow-ups coming due, won deals missing an SO,
 * and a rollup of their open pipeline.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const ctx = await requireContext()
  const memberId = ctx.memberId

  return runInTenant(ctx.tenantId, async (tx) => {
    // No member row → nothing personal to surface, but still show won/SO gaps.
    const myPendingApprovals: PendingApproval[] = memberId
      ? (
          await tx
            .select({
              id: stageApprovalRequests.id,
              opportunityId: stageApprovalRequests.opportunityId,
              opportunityName: opportunities.name,
              reason: stageApprovalRequests.reason,
              requestedAt: stageApprovalRequests.requestedAt,
            })
            .from(stageApprovalRequests)
            .innerJoin(
              opportunities,
              eq(opportunities.id, stageApprovalRequests.opportunityId)
            )
            .where(
              and(
                eq(stageApprovalRequests.approverMemberId, memberId),
                eq(stageApprovalRequests.status, "pending")
              )
            )
            .orderBy(asc(stageApprovalRequests.requestedAt))
        ).map((r) => ({
          id: r.id,
          opportunityId: r.opportunityId,
          opportunityName: r.opportunityName,
          reason: r.reason,
          requestedAt: r.requestedAt,
        }))
      : []

    const followUpsDue: FollowUpDue[] = memberId
      ? (
          await tx
            .select({
              id: activities.id,
              subject: activities.subject,
              entityType: activities.entityType,
              entityId: activities.entityId,
              dueAt: activities.dueAt,
            })
            .from(activities)
            .where(
              and(
                eq(activities.memberId, memberId),
                sql`${activities.dueAt} is not null`,
                lte(activities.dueAt, sql`now() + interval '7 days'`)
              )
            )
            .orderBy(asc(activities.dueAt))
        ).map((r) => ({
          id: r.id,
          subject: r.subject ?? "Follow-up",
          entityType: r.entityType,
          entityId: r.entityId,
          dueAt: r.dueAt as Date,
        }))
      : []

    const funnelsMissingSo: FunnelMissingSo[] = (
      await tx
        .select({
          id: opportunities.id,
          name: opportunities.name,
          amount: opportunities.amount,
          closedAt: opportunities.closedAt,
        })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.status, "won"),
            isNull(opportunities.soNumber),
            isNull(opportunities.deletedAt)
          )
        )
        .orderBy(asc(opportunities.name))
    ).map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      closedAt: r.closedAt,
    }))

    const [pipelineRow] = memberId
      ? await tx
          .select({
            count: sql<number>`count(*)::int`,
            total: sql<string>`coalesce(sum(${opportunities.amount}), 0)`,
          })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.ownerMemberId, memberId),
              eq(opportunities.status, "open"),
              isNull(opportunities.deletedAt)
            )
          )
      : [{ count: 0, total: "0" }]

    return {
      myPendingApprovals,
      followUpsDue,
      funnelsMissingSo,
      myOpenPipeline: {
        count: pipelineRow?.count ?? 0,
        total: pipelineRow?.total ?? "0",
      },
    }
  })
}
