import "server-only"
import { and, eq, isNull, lte, asc, sql, type SQL } from "drizzle-orm"
import { requireContext } from "@/lib/server-context"
import { db, runInTenant } from "@/db"
import {
  stageApprovalRequests,
  opportunities,
  activities,
  leads,
  accounts,
  persons,
  funnelStages,
  taxSettings,
  member,
} from "@/db/schema"
import { canViewAllRecords } from "@/lib/access-scope"
import { PERMISSIONS } from "@/lib/permissions"

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

/**
 * Derived completion for the getting-started checklist. Seeded items (funnel
 * stages + SST tax/currency) start checked so progress shows on day one.
 */
export type GettingStarted = {
  /** First lead captured. */
  hasLead: boolean
  /** At least one account or contact exists. */
  hasAccountOrContact: boolean
  /** Funnel stages reviewed (seeded by default → pre-checked). */
  hasStages: boolean
  /** Currency + SST tax configured (seeded by default → pre-checked). */
  hasCurrencyTax: boolean
  /** A teammate has been brought into the workspace. */
  hasTeammate: boolean
}

export type DashboardData = {
  /** Pending stage-approval requests the user can actually action: every
   *  pending request in the tenant for a broad approver, otherwise only those
   *  routed to them. Mirrors /approvals "Incoming" so the two never disagree. */
  pendingApprovals: PendingApproval[]
  /** True when the user is a broad approver (sees/acts on all pending requests),
   *  so the UI titles the card "Pending Approvals" rather than "Assigned to me". */
  canApproveAll: boolean
  followUpsDue: FollowUpDue[]
  /** The current member's own open funnel rollup ("My"). */
  myOpenPipeline: OpenPipeline
  /** Tenant-wide open funnel rollup ("Team"), present only for view-all roles
   *  (records.view_all / superadmin) so an Owner/Viewer who owns nothing still
   *  lands on a useful page. Null otherwise. */
  orgOpenPipeline: OpenPipeline | null
  /** True when the user may see all records (drives the My/Team toggle). */
  canViewAll: boolean
  /** True when the tenant has no leads/accounts/contacts/funnels yet — render
   *  the "Get started" hero instead of the "all caught up" dashboard. */
  isFirstRun: boolean
  gettingStarted: GettingStarted
}

/**
 * Build the actionable dashboard lists for the current member: approvals
 * awaiting their decision, follow-ups coming due, and a rollup of their open
 * pipeline.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const ctx = await requireContext()
  const memberId = ctx.memberId
  const canViewAll = canViewAllRecords(ctx)
  // A broad approver (or superadmin) can decide ANY pending request — see
  // listIncomingApprovals()/decideApproval() — so the dashboard must count those
  // too, otherwise it says "all caught up" while /approvals shows Incoming (n).
  const canApproveAll =
    ctx.isSuperadmin || ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE)

  return runInTenant(ctx.tenantId, async (tx) => {
    // Broad approvers see every pending request in the tenant; everyone else
    // only the ones routed to them. With no member row and no broad approval,
    // there is nothing actionable to surface.
    const approvalWhere: SQL | undefined = canApproveAll
      ? eq(stageApprovalRequests.status, "pending")
      : memberId
        ? and(
            eq(stageApprovalRequests.approverMemberId, memberId),
            eq(stageApprovalRequests.status, "pending")
          )
        : undefined

    const pendingApprovals: PendingApproval[] = approvalWhere
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
            .where(approvalWhere)
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
    // `ownerFilter` undefined → tenant-wide rollup (RLS still scopes to tenant).
    const pipelineFor = async (
      ownerFilter: SQL | undefined
    ): Promise<OpenPipeline> => {
      const rows = await tx
        .select({
          currency: opportunities.currency,
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${opportunities.amount}), 0)`,
        })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.status, "open"),
            isNull(opportunities.deletedAt),
            ownerFilter
          )
        )
        .groupBy(opportunities.currency)

      const count = rows.reduce((n, r) => n + Number(r.count), 0)
      const mixed = rows.length > 1
      const primary = rows[0]
      return {
        count,
        total: mixed ? "0" : primary?.total ?? "0",
        currency: mixed ? null : primary?.currency ?? null,
        mixed,
      }
    }

    const myOpenPipeline: OpenPipeline = memberId
      ? await pipelineFor(eq(opportunities.ownerMemberId, memberId))
      : { count: 0, total: "0", currency: null, mixed: false }
    // Tenant-wide rollup only for view-all roles; gives an Owner/Viewer who owns
    // nothing a useful landing page (the My/Team toggle defaults to this).
    const orgOpenPipeline: OpenPipeline | null = canViewAll
      ? await pipelineFor(undefined)
      : null

    // Tenant-wide existence checks for first-run detection + the getting-started
    // checklist. RLS scopes each count to the active tenant. Run sequentially —
    // they share the transaction's single connection.
    const num = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0)
    const leadCount = num(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(isNull(leads.deletedAt))
    )
    const accountCount = num(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(accounts)
        .where(isNull(accounts.deletedAt))
    )
    const personCount = num(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(persons)
        .where(isNull(persons.deletedAt))
    )
    const oppCount = num(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(isNull(opportunities.deletedAt))
    )
    const stageCount = num(
      await tx.select({ n: sql<number>`count(*)::int` }).from(funnelStages)
    )
    const taxCount = num(
      await tx.select({ n: sql<number>`count(*)::int` }).from(taxSettings)
    )

    // Member count is sourced from the auth schema (not tenant-RLS scoped), so
    // query it on the base connection by organization.
    const memberCount = num(
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(member)
        .where(eq(member.organizationId, ctx.tenantId))
    )

    const gettingStarted: GettingStarted = {
      hasLead: leadCount > 0,
      hasAccountOrContact: accountCount > 0 || personCount > 0,
      hasStages: stageCount > 0,
      hasCurrencyTax: taxCount > 0,
      hasTeammate: memberCount > 1,
    }

    const isFirstRun =
      leadCount === 0 &&
      accountCount === 0 &&
      personCount === 0 &&
      oppCount === 0

    return {
      pendingApprovals,
      canApproveAll,
      followUpsDue,
      myOpenPipeline,
      orgOpenPipeline,
      canViewAll,
      isFirstRun,
      gettingStarted,
    }
  })
}
