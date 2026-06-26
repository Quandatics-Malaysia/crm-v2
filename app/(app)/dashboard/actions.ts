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

export type OpenPipeline = {
  count: number
  total: string
  /** Currency of `total` when the open deals share one; null when mixed. */
  currency: string | null
  /** True when open deals span multiple currencies (total is not meaningful). */
  mixed: boolean
}

export type DashboardData = {
  myPendingApprovals: PendingApproval[]
  followUpsDue: FollowUpDue[]
  myOpenPipeline: OpenPipeline
}

/**
 * Build the actionable dashboard lists for the current member: approvals
 * awaiting their decision, follow-ups coming due, and a rollup of their open
 * pipeline.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const ctx = await requireContext()
  const memberId = ctx.memberId

  return runInTenant(ctx.tenantId, async (tx) => {
    // No member row → nothing personal to surface.
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

    // Grouped by currency so we never sum across currencies (no implicit FX).
    const pipelineRows = memberId
      ? await tx
          .select({
            currency: opportunities.currency,
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
          .groupBy(opportunities.currency)
      : []

    const count = pipelineRows.reduce((n, r) => n + Number(r.count), 0)
    const mixed = pipelineRows.length > 1
    const primary = pipelineRows[0]

    return {
      myPendingApprovals,
      followUpsDue,
      myOpenPipeline: {
        count,
        total: mixed ? "0" : primary?.total ?? "0",
        currency: mixed ? null : primary?.currency ?? null,
        mixed,
      },
    }
  })
}
