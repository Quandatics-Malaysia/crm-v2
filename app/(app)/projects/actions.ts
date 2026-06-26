"use server"

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant, type Tx } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  projects,
  projectStatus,
  accounts,
  opportunities,
  quotations,
  member,
  user,
  paymentMilestones,
  paymentMilestoneStatus,
} from "@/db/schema"
import { nextProjectCode } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { opportunityNetValue } from "@/server/services/value"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"

export type ProjectRow = typeof projects.$inferSelect
export type ProjectStatus = (typeof projectStatus.enumValues)[number]

export type ProjectListItem = {
  id: string
  projectCode: string
  name: string
  accountId: string
  accountName: string | null
  opportunityId: string | null
  opportunityName: string | null
  status: ProjectStatus
  value: string | null
  currency: string
  startDate: string | null
}

export type ProjectDetail = {
  project: ProjectRow
  accountName: string | null
  opportunityName: string | null
  quotationNumber: string | null
  ownerName: string | null
}

export type ProjectCodeNature = "auto" | "manual"

export type ProjectCreateInput = {
  name: string
  accountId: string
  opportunityId?: string
  quotationId?: string
  value?: string
  startDate?: string
  status?: string
  /** "auto" (system-generated) or "manual" (user-entered). Defaults to "auto". */
  codeNature?: ProjectCodeNature
  /** Required when codeNature is "manual"; ignored otherwise. */
  projectCode?: string
}

export type ProjectUpdateInput = {
  name?: string
  accountId?: string
  opportunityId?: string | null
  quotationId?: string | null
  value?: string | null
  startDate?: string | null
  status?: string
}

/** All non-deleted projects with denormalized account + funnel names, newest first. */
export async function listProjects(): Promise<ProjectListItem[]> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const rows = await tx
      .select({
        id: projects.id,
        projectCode: projects.projectCode,
        name: projects.name,
        accountId: projects.accountId,
        accountName: accounts.name,
        opportunityId: projects.opportunityId,
        opportunityName: opportunities.name,
        status: projects.status,
        value: projects.value,
        currency: projects.currency,
        startDate: projects.startDate,
      })
      .from(projects)
      .leftJoin(accounts, eq(projects.accountId, accounts.id))
      .leftJoin(opportunities, eq(projects.opportunityId, opportunities.id))
      .where(
        and(
          isNull(projects.deletedAt),
          ownerScope(projects.ownerMemberId, visible)
        )
      )
      .orderBy(desc(projects.createdAt))
    return rows
  })
}

/** Full detail for one project with linked account / funnel / quotation / owner. */
export async function getProject(id: string): Promise<ProjectDetail | null> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [row] = await tx
      .select({
        project: projects,
        accountName: accounts.name,
        opportunityName: opportunities.name,
        quotationNumber: quotations.quoteNumber,
        ownerName: user.name,
      })
      .from(projects)
      .leftJoin(accounts, eq(projects.accountId, accounts.id))
      .leftJoin(opportunities, eq(projects.opportunityId, opportunities.id))
      .leftJoin(quotations, eq(projects.quotationId, quotations.id))
      .leftJoin(member, eq(projects.ownerMemberId, member.id))
      .leftJoin(user, eq(member.userId, user.id))
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1)
    if (!row) return null
    if (!ownsOrManages(visible, row.project.ownerMemberId)) return null
    return {
      project: row.project,
      accountName: row.accountName,
      opportunityName: row.opportunityName,
      quotationNumber: row.quotationNumber,
      ownerName: row.ownerName,
    }
  })
}

function isStatus(v: string | undefined): v is ProjectStatus {
  return !!v && (projectStatus.enumValues as readonly string[]).includes(v)
}

export async function createProject(
  input: ProjectCreateInput
): Promise<{ id: string; projectCode: string }> {
  const created = await withTenant(
    PERMISSIONS.PROJECT_CREATE,
    async (tx, ctx) => {
      const [acct] = await tx
        .select({ code: accounts.code })
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
        .limit(1)
      if (!acct) throw new Error("Account not found")

      // Default to "auto" so the funnel "create project" path (and any caller
      // that omits codeNature) keeps auto-generating as before.
      const codeNature: ProjectCodeNature =
        input.codeNature === "manual" ? "manual" : "auto"

      let projectCode: string
      if (codeNature === "manual") {
        projectCode = (input.projectCode ?? "").trim()
        if (!projectCode) throw new Error("Project code is required")
        // Enforce per-tenant uniqueness up front for a friendly message.
        const [clash] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.tenantId, ctx.tenantId),
              eq(projects.projectCode, projectCode)
            )
          )
          .limit(1)
        if (clash) throw new Error("Project code already exists")
      } else {
        projectCode = await nextProjectCode(tx, ctx, acct.code ?? "")
      }

      const [row] = await tx
        .insert(projects)
        .values({
          tenantId: ctx.tenantId,
          projectCode,
          codeNature,
          name: input.name,
          accountId: input.accountId,
          opportunityId: input.opportunityId || null,
          quotationId: input.quotationId || null,
          ownerMemberId: ctx.memberId,
          status: isStatus(input.status) ? input.status : "planning",
          value: input.value ? input.value : null,
          startDate: input.startDate || null,
        })
        .returning({ id: projects.id, projectCode: projects.projectCode })

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: row.id,
        type: "system",
        subject: "Project created",
      })
      return row
    }
  )
  revalidatePath("/projects")
  return created
}

export async function updateProject(
  id: string,
  input: ProjectUpdateInput
): Promise<void> {
  await withTenant(PERMISSIONS.PROJECT_UPDATE, async (tx, ctx) => {
    const [existing] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Project not found")

    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId)) {
      throw new Error("FORBIDDEN: not permitted on this project")
    }

    await tx
      .update(projects)
      .set({
        name: input.name ?? existing.name,
        accountId: input.accountId ?? existing.accountId,
        opportunityId:
          input.opportunityId === undefined
            ? existing.opportunityId
            : input.opportunityId || null,
        quotationId:
          input.quotationId === undefined
            ? existing.quotationId
            : input.quotationId || null,
        status: isStatus(input.status) ? input.status : existing.status,
        value:
          input.value === undefined
            ? existing.value
            : input.value
              ? input.value
              : null,
        startDate:
          input.startDate === undefined
            ? existing.startDate
            : input.startDate || null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))

    await logActivity(tx, ctx, {
      entityType: "project",
      entityId: id,
      type: "system",
      subject: "Project updated",
    })
  })
  revalidatePath("/projects")
  revalidatePath(`/projects/${id}`)
}

export async function deleteProject(id: string): Promise<void> {
  await withTenant(PERMISSIONS.PROJECT_DELETE, async (tx, ctx) => {
    const [existing] = await tx
      .select({ ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1)
    if (!existing) throw new Error("Project not found")

    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId)) {
      throw new Error("FORBIDDEN: not permitted on this project")
    }

    const [updated] = await tx
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning({ id: projects.id })
    if (!updated) throw new Error("Project not found")

    await logActivity(tx, ctx, {
      entityType: "project",
      entityId: id,
      type: "system",
      subject: "Project deleted",
    })
  })
  revalidatePath("/projects")
}

/** Open opportunities (funnels) for the create-form picker, with their account. */
export async function listOpportunityOptions(): Promise<
  { id: string; name: string; accountId: string }[]
> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    return tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
      })
      .from(opportunities)
      .where(
        and(
          isNull(opportunities.deletedAt),
          ownerScope(opportunities.ownerMemberId, visible)
        )
      )
      .orderBy(asc(opportunities.name))
  })
}

export type ProjectPrefill = {
  accountId: string
  accountName: string | null
  value: string
  quotationId: string | null
  quoteNumber: string | null
  opportunityName: string
}

/**
 * Prefill a new project from a funnel (opportunity). Value, quotationId and
 * quoteNumber are derived from the opportunity's net (ex-tax) deal value via
 * the shared value service — i.e. the source quotation. The account is read
 * from the opportunity so the form can preselect it.
 */
export async function prefillFromOpportunity(
  opportunityId: string
): Promise<ProjectPrefill | null> {
  return withTenant(PERMISSIONS.PROJECT_CREATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [opp] = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
        ownerMemberId: opportunities.ownerMemberId,
      })
      .from(opportunities)
      .leftJoin(accounts, eq(opportunities.accountId, accounts.id))
      .where(
        and(
          eq(opportunities.id, opportunityId),
          isNull(opportunities.deletedAt)
        )
      )
      .limit(1)
    if (!opp) return null
    if (!ownsOrManages(visible, opp.ownerMemberId)) throw new Error("FORBIDDEN")

    const { value, fromQuoteId, quoteNumber } = await opportunityNetValue(
      tx,
      opportunityId
    )

    return {
      accountId: opp.accountId,
      accountName: opp.accountName,
      value,
      quotationId: fromQuoteId,
      quoteNumber,
      opportunityName: opp.name,
    }
  })
}

// ── Payment milestones ──────────────────────────────────────────────────────

export type MilestoneRow = typeof paymentMilestones.$inferSelect
export type MilestoneStatus = (typeof paymentMilestoneStatus.enumValues)[number]

export type MilestoneItem = {
  id: string
  projectId: string
  quotationId: string | null
  title: string
  amount: string
  percentage: string | null
  dueDate: string | null
  status: MilestoneStatus
  sortOrder: number
}

export type MilestoneCreateInput = {
  projectId: string
  title: string
  amount?: string | null
  percentage?: string | null
  dueDate?: string | null
}

export type MilestoneUpdateInput = {
  title?: string
  amount?: string | null
  percentage?: string | null
  dueDate?: string | null
  status?: string
}

function isMilestoneStatus(v: string | undefined): v is MilestoneStatus {
  return (
    !!v && (paymentMilestoneStatus.enumValues as readonly string[]).includes(v)
  )
}

/** Sum of milestone amounts for a project, optionally excluding one milestone. */
async function allocatedTotal(
  tx: Tx,
  projectId: string,
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
            eq(paymentMilestones.projectId, projectId),
            ne(paymentMilestones.id, excludeId)
          )
        : eq(paymentMilestones.projectId, projectId)
    )
  return Number(row?.total ?? 0)
}

/** Whole-cent comparison to avoid float drift when reconciling money. */
const cents = (n: number) => Math.round(n * 100)

/** All milestones for a project, ordered by sortOrder then creation. */
export async function listMilestones(
  projectId: string
): Promise<MilestoneItem[]> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [project] = await tx
      .select({ ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
    if (!project) return []
    if (!ownsOrManages(visible, project.ownerMemberId)) return []

    const rows = await tx
      .select({
        id: paymentMilestones.id,
        projectId: paymentMilestones.projectId,
        quotationId: paymentMilestones.quotationId,
        title: paymentMilestones.title,
        amount: paymentMilestones.amount,
        percentage: paymentMilestones.percentage,
        dueDate: paymentMilestones.dueDate,
        status: paymentMilestones.status,
        sortOrder: paymentMilestones.sortOrder,
      })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, projectId))
      .orderBy(asc(paymentMilestones.sortOrder), asc(paymentMilestones.createdAt))
    return rows
  })
}

export async function createMilestone(
  input: MilestoneCreateInput
): Promise<{ id: string }> {
  const created = await withTenant(
    PERMISSIONS.PROJECT_UPDATE,
    async (tx, ctx) => {
      // Lock the project row so concurrent milestone writes on the same
      // project serialize — otherwise two racing inserts could each pass the
      // reconciliation check below and jointly over-allocate.
      const [project] = await tx
        .select({
          id: projects.id,
          value: projects.value,
          quotationId: projects.quotationId,
          ownerMemberId: projects.ownerMemberId,
        })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), isNull(projects.deletedAt))
        )
        .limit(1)
        .for("update")
      if (!project) throw new Error("Project not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, project.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this project")
      }

      const title = input.title.trim()
      if (!title) throw new Error("Title is required")

      const projectValue = project.value ? Number(project.value) : 0
      const pct =
        input.percentage != null && input.percentage !== ""
          ? Number(input.percentage)
          : null

      // Derive amount from percentage of the project value when amount omitted.
      let amount: string
      if (input.amount != null && input.amount !== "") {
        amount = input.amount
      } else if (pct != null && Number.isFinite(pct)) {
        amount = (Math.round(projectValue * (pct / 100) * 100) / 100).toFixed(2)
      } else {
        amount = "0"
      }

      // Reconciliation: total milestone amounts may not exceed the project
      // value (the quotation-derived source of value). Skipped when no value.
      // Only block when this addition actually pushes the total higher (a $0
      // line on an already-over-allocated project is allowed), mirroring update.
      if (projectValue > 0) {
        const existingTotal = await allocatedTotal(tx, input.projectId)
        const newTotal = existingTotal + Number(amount)
        if (
          cents(newTotal) > cents(projectValue) &&
          cents(newTotal) > cents(existingTotal)
        ) {
          throw new Error(
            "Milestones would exceed the project value. Lower the amount or adjust other milestones."
          )
        }
      }

      const [{ maxSort }] = await tx
        .select({
          maxSort: sql<number>`coalesce(max(${paymentMilestones.sortOrder}), -1)`,
        })
        .from(paymentMilestones)
        .where(eq(paymentMilestones.projectId, input.projectId))

      const [row] = await tx
        .insert(paymentMilestones)
        .values({
          tenantId: ctx.tenantId,
          projectId: input.projectId,
          quotationId: project.quotationId,
          title,
          amount,
          percentage: pct != null && Number.isFinite(pct) ? String(pct) : null,
          dueDate: input.dueDate || null,
          sortOrder: Number(maxSort) + 1,
        })
        .returning({ id: paymentMilestones.id })

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: input.projectId,
        type: "system",
        subject: `Milestone added: ${title}`,
      })
      return row
    }
  )
  revalidatePath(`/projects/${input.projectId}`)
  return created
}

export async function updateMilestone(
  id: string,
  input: MilestoneUpdateInput
): Promise<void> {
  const projectId = await withTenant(
    PERMISSIONS.PROJECT_UPDATE,
    async (tx, ctx) => {
      const [existing] = await tx
        .select()
        .from(paymentMilestones)
        .where(eq(paymentMilestones.id, id))
        .limit(1)
      if (!existing) throw new Error("Milestone not found")

      // Lock the project row so concurrent milestone writes serialize against
      // the reconciliation check below (same guard as createMilestone).
      const [project] = await tx
        .select({ value: projects.value, ownerMemberId: projects.ownerMemberId })
        .from(projects)
        .where(eq(projects.id, existing.projectId))
        .limit(1)
        .for("update")

      const visible = await visibleMemberIds(tx, ctx)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, project?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this project")
      }

      const projectValue = project?.value ? Number(project.value) : 0

      const nextPercentage =
        input.percentage === undefined
          ? existing.percentage
          : input.percentage
            ? input.percentage
            : null

      // An explicit amount always wins. Otherwise, if the percentage was just
      // changed (and is non-null), re-derive the amount from it against the
      // project value — mirroring createMilestone, so editing "% of value"
      // keeps the amount and the allocation totals consistent.
      let nextAmount: string
      if (input.amount !== undefined) {
        nextAmount = input.amount ? input.amount : "0"
      } else if (input.percentage !== undefined && nextPercentage != null) {
        const pct = Number(nextPercentage)
        nextAmount = Number.isFinite(pct)
          ? (Math.round(projectValue * (pct / 100) * 100) / 100).toFixed(2)
          : existing.amount
      } else {
        nextAmount = existing.amount
      }

      // Reconciliation: block edits that push the milestone total over the
      // project value. Edits that don't raise the total (title/date/status, or
      // lowering an amount) are always allowed, even if already over-allocated.
      if (projectValue > 0) {
        const otherTotal = await allocatedTotal(tx, existing.projectId, id)
        const newTotal = otherTotal + Number(nextAmount)
        const oldTotal = otherTotal + Number(existing.amount)
        if (
          cents(newTotal) > cents(projectValue) &&
          cents(newTotal) > cents(oldTotal)
        ) {
          throw new Error(
            "Milestones would exceed the project value. Lower the amount or adjust other milestones."
          )
        }
      }

      const nextStatus = isMilestoneStatus(input.status)
        ? input.status
        : existing.status
      // Status is forward-only: pending → invoiced → paid. It may stay or
      // advance, never move back (a paid/invoiced milestone can't revert).
      if (
        nextStatus !== existing.status &&
        paymentMilestoneStatus.enumValues.indexOf(nextStatus) <
          paymentMilestoneStatus.enumValues.indexOf(existing.status)
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
          amount: nextAmount,
          percentage: nextPercentage,
          dueDate:
            input.dueDate === undefined
              ? existing.dueDate
              : input.dueDate || null,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(paymentMilestones.id, id))

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: existing.projectId,
        type: "system",
        subject:
          nextStatus !== existing.status
            ? `Milestone ${nextTitle} marked ${nextStatus}`
            : `Milestone updated: ${nextTitle}`,
      })

      return existing.projectId
    }
  )
  revalidatePath(`/projects/${projectId}`)
}

export async function deleteMilestone(id: string): Promise<void> {
  const projectId = await withTenant(
    PERMISSIONS.PROJECT_UPDATE,
    async (tx, ctx) => {
      const [milestone] = await tx
        .select({ projectId: paymentMilestones.projectId })
        .from(paymentMilestones)
        .where(eq(paymentMilestones.id, id))
        .limit(1)
      if (!milestone) throw new Error("Milestone not found")

      const [project] = await tx
        .select({ ownerMemberId: projects.ownerMemberId })
        .from(projects)
        .where(eq(projects.id, milestone.projectId))
        .limit(1)
      const visible = await visibleMemberIds(tx, ctx)
      if (
        !canManageAllRecords(ctx) &&
        !ownsOrManages(visible, project?.ownerMemberId ?? null)
      ) {
        throw new Error("FORBIDDEN: not permitted on this project")
      }

      const [deleted] = await tx
        .delete(paymentMilestones)
        .where(eq(paymentMilestones.id, id))
        .returning({
          projectId: paymentMilestones.projectId,
          title: paymentMilestones.title,
        })
      if (!deleted) throw new Error("Milestone not found")

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: deleted.projectId,
        type: "system",
        subject: `Milestone deleted: ${deleted.title}`,
      })
      return deleted.projectId
    }
  )
  revalidatePath(`/projects/${projectId}`)
}

/**
 * Persist a new milestone ordering. `order` is milestone ids in the desired
 * sequence; sortOrder is rewritten to match the index. Scoped to the project
 * (and tenant via RLS) so only this project's milestones are touched. There is
 * no unique (projectId, sortOrder) constraint, so a single pass is safe.
 */
export async function reorderMilestones(
  projectId: string,
  order: string[]
): Promise<void> {
  await withTenant(PERMISSIONS.PROJECT_UPDATE, async (tx, ctx) => {
    const [project] = await tx
      .select({ ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
    if (!project) throw new Error("Project not found")

    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, project.ownerMemberId)) {
      throw new Error("FORBIDDEN: not permitted on this project")
    }

    for (let i = 0; i < order.length; i++) {
      await tx
        .update(paymentMilestones)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(paymentMilestones.id, order[i]),
            eq(paymentMilestones.projectId, projectId)
          )
        )
    }
  })
  revalidatePath(`/projects/${projectId}`)
}
