import "server-only"
import { and, eq, isNull, lte, asc, sql, type SQL } from "drizzle-orm"
import { requireContext } from "@/lib/server-context"
import { db, runInTenant } from "@/db"
import {
  stageApprovalRequests,
  funnels,
  activities,
  leads,
  accounts,
  persons,
  pipelineStages,
  taxSettings,
  member,
  user,
  tenantSettings,
  financeDocs,
  opportunityProducts,
} from "@/db/schema"
import { isModuleEnabled } from "@/lib/modules"
import { DEFAULT_REMINDER_DAYS } from "@/lib/tenant-defaults"
import { canViewAllRecords } from "@/lib/access-scope"
import { PERMISSIONS } from "@/lib/permissions"

export type PendingApproval = {
  id: string
  funnelId: string
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

export type StaleDeal = {
  id: string
  name: string
  /** Last touch = the later of the funnel's own update and its latest activity. */
  lastTouchAt: Date
}

export type OverdueInvoice = {
  id: string
  number: string
  partyName: string | null
  amount: string
  currency: string
  dueDate: string
  reminderStage: number
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
 * One stacked-bar segment for the "QM Sales Report by Salesperson" chart:
 * a single (Funnel Owner × Sales Stage) cell, measured by the summed
 * estimated funnel amount. Amounts are summed regardless of currency — the
 * Salesforce source is single-currency (MYR), matching this tenant's default.
 */
export type SalesByOwnerStage = {
  ownerMemberId: string
  ownerName: string
  stageId: string
  stageName: string
  /** Stage ladder position, so the client can order/stack segments. */
  stageSort: number
  /** Σ estimated funnel amount for this owner×stage cell. */
  amount: number
}

/**
 * One bar for the "Quandatics Closed Deals by Products" chart: the summed
 * line-item amount of CLOSED-WON funnels grouped by product category.
 * Sourced from opportunity_products (the SF OpportunityLineItem import),
 * which carries the productCategory + line totalPrice.
 */
export type ClosedDealsByProduct = {
  category: string
  amount: number
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
  /** My open pipelines with no activity for `staleDealDays` (empty when off). */
  staleDeals: StaleDeal[]
  /** The configured nudge threshold (null = feature off). */
  staleDealDays: number | null
  /** Issued customer invoices past their due date (finance module only). */
  overdueInvoices: OverdueInvoice[]
  /** Reminder schedule (days after due) for the reminder-stage chips. */
  reminderSchedule: number[]
  /** The current member's own open funnel rollup ("My"). */
  myOpenPipeline: OpenPipeline
  /** Tenant-wide open funnel rollup ("Team"), present only for view-all roles
   *  (records.view_all / superadmin) so an Owner/Viewer who owns nothing still
   *  lands on a useful page. Null otherwise. */
  orgOpenPipeline: OpenPipeline | null
  /** True when the user may see all records (drives the My/Team toggle). */
  canViewAll: boolean
  /** True when the tenant has no leads/accounts/contacts/pipelines yet — render
   *  the "Get started" hero instead of the "all caught up" dashboard. */
  isFirstRun: boolean
  gettingStarted: GettingStarted
  /** SF "QM Sales Report by Salesperson" — Σ estimated amount by owner×stage. */
  salesByOwnerStage: SalesByOwnerStage[]
  /** SF "Quandatics Closed Deals by Products" — Σ line amount by product category. */
  closedDealsByProduct: ClosedDealsByProduct[]
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
              funnelId: stageApprovalRequests.funnelId,
              opportunityName: funnels.name,
              reason: stageApprovalRequests.reason,
              requestedAt: stageApprovalRequests.requestedAt,
            })
            .from(stageApprovalRequests)
            .innerJoin(
              funnels,
              eq(funnels.id, stageApprovalRequests.funnelId)
            )
            .where(approvalWhere)
            .orderBy(asc(stageApprovalRequests.requestedAt))
        ).map((r) => ({
          id: r.id,
          funnelId: r.funnelId,
          opportunityName: r.opportunityName,
          reason: r.reason,
          requestedAt: r.requestedAt,
        }))
      : []

    // Behavior windows — tenant-configurable (Settings → General → Behavior).
    const [s] = await tx
      .select({
        followUpDueDays: tenantSettings.followUpDueDays,
        staleDealDays: tenantSettings.staleDealDays,
        invoiceReminderDays: tenantSettings.invoiceReminderDays,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    const dueDays = s?.followUpDueDays ?? 7
    const staleDealDays = s?.staleDealDays ?? null

    // Overdue customer invoices — finance add-on, capability-gated.
    const financeOn =
      isModuleEnabled("finance") && ctx.can(PERMISSIONS.FINANCE_VIEW)
    const reminderSchedule = financeOn
      ? s?.invoiceReminderDays?.length
        ? s.invoiceReminderDays
        : DEFAULT_REMINDER_DAYS
      : []
    const overdueInvoices: OverdueInvoice[] = financeOn
      ? await tx
          .select({
            id: financeDocs.id,
            number: financeDocs.number,
            partyName: financeDocs.partyName,
            amount: financeDocs.amount,
            currency: financeDocs.currency,
            dueDate: sql<string>`${financeDocs.dueDate}`,
            reminderStage: financeDocs.reminderStage,
          })
          .from(financeDocs)
          .where(
            and(
              eq(financeDocs.kind, "invoice"),
              eq(financeDocs.status, "issued"),
              sql`${financeDocs.dueDate} < current_date`
            )
          )
          .orderBy(asc(financeDocs.dueDate))
          .limit(10)
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
                lte(
                  activities.dueAt,
                  sql`now() + make_interval(days => ${dueDays})`
                )
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

    // Stale-funnel nudges: MY open deals whose last touch — the later of the
    // record's own update and its newest activity — is older than the
    // threshold. Oldest first, capped so a long-neglected book doesn't flood
    // the dashboard.
    const staleDeals: StaleDeal[] =
      staleDealDays && memberId
        ? (
            await tx
              .select({
                id: funnels.id,
                name: funnels.name,
                lastTouchAt: sql<Date>`greatest(${funnels.updatedAt}, coalesce(max(${activities.occurredAt}), ${funnels.updatedAt}))`,
              })
              .from(funnels)
              .leftJoin(
                activities,
                and(
                  eq(activities.entityType, "opportunity"),
                  eq(activities.entityId, funnels.id)
                )
              )
              .where(
                and(
                  eq(funnels.status, "open"),
                  isNull(funnels.deletedAt),
                  eq(funnels.ownerMemberId, memberId)
                )
              )
              .groupBy(funnels.id)
              .having(
                sql`greatest(${funnels.updatedAt}, coalesce(max(${activities.occurredAt}), ${funnels.updatedAt})) < now() - make_interval(days => ${staleDealDays})`
              )
              .orderBy(
                sql`greatest(${funnels.updatedAt}, coalesce(max(${activities.occurredAt}), ${funnels.updatedAt})) asc`
              )
              .limit(10)
          ).map((r) => ({
            id: r.id,
            name: r.name,
            lastTouchAt: new Date(r.lastTouchAt),
          }))
        : []

    // Grouped by currency so we never sum across currencies (no implicit FX).
    // `ownerFilter` undefined → tenant-wide rollup (RLS still scopes to tenant).
    const pipelineFor = async (
      ownerFilter: SQL | undefined
    ): Promise<OpenPipeline> => {
      const rows = await tx
        .select({
          currency: funnels.currency,
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${funnels.amount}), 0)`,
        })
        .from(funnels)
        .where(
          and(
            eq(funnels.status, "open"),
            isNull(funnels.deletedAt),
            ownerFilter
          )
        )
        .groupBy(funnels.currency)

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
      ? await pipelineFor(eq(funnels.ownerMemberId, memberId))
      : { count: 0, total: "0", currency: null, mixed: false }
    // Tenant-wide rollup only for view-all roles; gives an Owner/Viewer who owns
    // nothing a useful landing page (the My/Team toggle defaults to this).
    const orgOpenPipeline: OpenPipeline | null = canViewAll
      ? await pipelineFor(undefined)
      : null

    // ── SF home charts (right column, "Salesperson's Funnels") ──────────────
    // Chart 1 — "QM Sales Report by Salesperson": Σ estimated funnel amount by
    // Funnel Owner × Sales Stage. Tenant-wide (RLS scopes to the tenant); the
    // owner name comes from the auth schema (member → user), joined the same
    // way listOpportunities() does. Excludes soft-deleted funnels.
    const salesByOwnerStage: SalesByOwnerStage[] = (
      await tx
        .select({
          ownerMemberId: funnels.ownerMemberId,
          ownerName: user.name,
          stageId: pipelineStages.id,
          stageName: pipelineStages.name,
          stageSort: pipelineStages.sortOrder,
          amount: sql<string>`coalesce(sum(${funnels.estimatedAmount}), 0)`,
        })
        .from(funnels)
        .innerJoin(pipelineStages, eq(funnels.currentStageId, pipelineStages.id))
        .leftJoin(member, eq(funnels.ownerMemberId, member.id))
        .leftJoin(user, eq(member.userId, user.id))
        .where(isNull(funnels.deletedAt))
        .groupBy(
          funnels.ownerMemberId,
          user.name,
          pipelineStages.id,
          pipelineStages.name,
          pipelineStages.sortOrder
        )
    ).map((r) => ({
      ownerMemberId: r.ownerMemberId,
      ownerName: r.ownerName ?? "Unassigned",
      stageId: r.stageId,
      stageName: r.stageName,
      stageSort: r.stageSort,
      amount: Number(r.amount),
    }))

    // Chart 2 — "Quandatics Closed Deals by Products": Σ line amount by product
    // category for CLOSED-WON funnels. Sourced from opportunity_products (the SF
    // OpportunityLineItem import), which is the only table carrying both a
    // product category and a per-line amount. Reading it is RLS-scoped and does
    // not require enabling any module (deferral is UI/automation only). Lines
    // with no category fall under "Uncategorized".
    const closedDealsByProduct: ClosedDealsByProduct[] = (
      await tx
        .select({
          category: sql<string>`coalesce(nullif(${opportunityProducts.productCategory}, ''), 'Uncategorized')`,
          amount: sql<string>`coalesce(sum(coalesce(${opportunityProducts.totalPrice}, 0)), 0)`,
        })
        .from(opportunityProducts)
        .innerJoin(funnels, eq(opportunityProducts.funnelId, funnels.id))
        .where(and(eq(funnels.status, "won"), isNull(funnels.deletedAt)))
        .groupBy(
          sql`coalesce(nullif(${opportunityProducts.productCategory}, ''), 'Uncategorized')`
        )
    ).map((r) => ({
      category: r.category,
      amount: Number(r.amount),
    }))

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
        .from(funnels)
        .where(isNull(funnels.deletedAt))
    )
    const stageCount = num(
      await tx.select({ n: sql<number>`count(*)::int` }).from(pipelineStages)
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
      staleDeals,
      staleDealDays,
      overdueInvoices,
      reminderSchedule,
      myOpenPipeline,
      orgOpenPipeline,
      canViewAll,
      isFirstRun,
      gettingStarted,
      salesByOwnerStage,
      closedDealsByProduct,
    }
  })
}
