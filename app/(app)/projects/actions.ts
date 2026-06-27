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
  salesOrders,
  tenantSettings,
} from "@/db/schema"
import { toDateString } from "@/lib/dates"
import { nextProjectCode, isDuplicateNumberError } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { opportunityNetValue } from "@/server/services/value"
import { writeAudit } from "@/server/audit"
import { runAction, type ActionResult } from "@/lib/action-result"
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
  /** ISO-4217 currency carried from the source opportunity/quotation; MYR if absent. */
  currency?: string
  startDate?: string
  status?: string
  /** "auto" (system-generated) or "manual" (user-entered). Defaults to "auto". */
  codeNature?: ProjectCodeNature
  /** Required when codeNature is "manual"; ignored otherwise. */
  projectCode?: string
  /**
   * Product-type code chosen from the tenant's product_types picklist. Used as
   * the PRODUCTTYPE segment of an auto-generated code and snapshotted onto the
   * project so its code stays stable if the picklist later changes.
   */
  productTypeCode?: string
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
      // Capped server-side; the list table surfaces a "refine your search"
      // notice at this count (cap={1000}) so rows never silently vanish.
      .limit(1000)
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
): Promise<ActionResult<{ id: string; projectCode: string }>> {
  return runAction(async () => {
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

      // Snapshotted onto the project (both natures) so the chosen product-type
      // code stays stable even if the tenant later edits its picklist.
      const productTypeCode = (input.productTypeCode ?? "").trim()

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
        // Foundation backfills account codes, but guard the gap: without a code
        // the ACCOUNTCODE segment would silently fall back, so block and tell
        // the user to set it rather than mint an ambiguous code.
        if (!acct.code) {
          throw new Error(
            "This account has no account code yet. Set the account's code before creating a project."
          )
        }
        projectCode = await nextProjectCode(tx, ctx, {
          accountCode: acct.code,
          productTypeCode,
        })
      }

      let row: { id: string; projectCode: string }
      try {
        ;[row] = await tx
          .insert(projects)
          .values({
            tenantId: ctx.tenantId,
            projectCode,
            codeNature,
            productTypeCode: productTypeCode || null,
            name: input.name,
            accountId: input.accountId,
            opportunityId: input.opportunityId || null,
            quotationId: input.quotationId || null,
            ownerMemberId: ctx.memberId,
            status: isStatus(input.status) ? input.status : "planning",
            value: input.value ? input.value : null,
            // Carry the source deal currency through; the column defaults to MYR
            // only when the caller has no currency to propagate.
            ...(input.currency ? { currency: input.currency } : {}),
            startDate: input.startDate || null,
          })
          .returning({ id: projects.id, projectCode: projects.projectCode })
      } catch (e) {
        // A minted/entered project code that collides with an existing one
        // (e.g. the tenant's "Next number" was set too low). Surface a friendly
        // retry instead of the raw unique-constraint error.
        if (isDuplicateNumberError(e)) {
          throw new Error(
            codeNature === "manual"
              ? "Project code already exists. Choose a different code."
              : "Could not assign a unique project code — please try again or raise the project Next number in Settings."
          )
        }
        throw e
      }

      await logActivity(tx, ctx, {
        entityType: "project",
        entityId: row.id,
        type: "system",
        subject: "Project created",
      })

      await writeAudit(tx, ctx, {
        action: "project.created",
        entityType: "project",
        entityId: row.id,
        after: {
          projectCode: row.projectCode,
          value: input.value ?? null,
          currency: input.currency ?? "MYR",
        },
      })
      return row
    }
  )
  revalidatePath("/projects")
  return created
  })
}

export async function updateProject(
  id: string,
  input: ProjectUpdateInput
): Promise<ActionResult<void>> {
  return runAction(async () => {
  await withTenant(PERMISSIONS.PROJECT_UPDATE, async (tx, ctx) => {
    // Lock the project row so this value edit serializes against concurrent
    // milestone writes (which also lock it) before reconciling allocation.
    const [existing] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1)
      .for("update")
    if (!existing) throw new Error("Project not found")

    const visible = await visibleMemberIds(tx, ctx)
    if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId)) {
      throw new Error("FORBIDDEN: not permitted on this project")
    }

    const nextValue =
      input.value === undefined
        ? existing.value
        : input.value
          ? input.value
          : null

    // Value can't be lowered below the total already allocated to milestones,
    // otherwise the project silently becomes over-allocated.
    if (nextValue != null) {
      const allocated = await allocatedTotal(tx, id)
      if (cents(allocated) > cents(Number(nextValue))) {
        throw new Error(
          "Project value cannot be lower than the total already allocated to milestones."
        )
      }
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
        value: nextValue,
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

    await writeAudit(tx, ctx, {
      action: "project.updated",
      entityType: "project",
      entityId: id,
      before: { value: existing.value },
      after: { value: nextValue },
    })
  })
  revalidatePath("/projects")
  revalidatePath(`/projects/${id}`)
  })
}

export async function deleteProject(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
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

    // Soft-delete doesn't fire the cascade FKs on sales_orders / payment_
    // milestones, so an approved (number-minted) SO would keep showing in the
    // global list pointing at a hidden project, and milestones would orphan.
    // Refuse while live dependents exist, mirroring deleteAccount's guard.
    const [{ soCount }] = await tx
      .select({
        soCount: sql<number>`count(*)`,
      })
      .from(salesOrders)
      .where(
        and(eq(salesOrders.projectId, id), ne(salesOrders.status, "rejected"))
      )
    if (Number(soCount) > 0) {
      throw new Error(
        "This project has active sales orders. Reject them before deleting the project."
      )
    }

    const [{ milestoneCount }] = await tx
      .select({ milestoneCount: sql<number>`count(*)` })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.projectId, id))
    if (Number(milestoneCount) > 0) {
      throw new Error(
        "This project has payment milestones. Remove them before deleting the project."
      )
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

    await writeAudit(tx, ctx, {
      action: "project.deleted",
      entityType: "project",
      entityId: id,
    })
  })
  revalidatePath("/projects")
  })
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

export type ProductTypeOption = { code: string; name: string }

export type ProjectCreateMeta = {
  /** Tenant-managed product-type picklist for the required Product Type field. */
  productTypes: ProductTypeOption[]
  /** ENTITY segment of the project code (tenant_settings.entityCode). */
  entityCode: string
  /** Current local calendar year — the YYYY segment of the live code preview. */
  year: number
  /** Visible accounts' short codes, keyed by account id, for the live preview. */
  accountCodes: Record<string, string>
}

/**
 * Bundle of tenant data the create form needs to render the Product Type picker
 * and the live project-code preview ({YYYY}-{ENTITY}-{ACCOUNTCODE}-{TYPE}-###).
 */
export async function listProjectCreateMeta(): Promise<ProjectCreateMeta> {
  return withTenant(PERMISSIONS.PROJECT_CREATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [s] = await tx
      .select({
        productTypes: tenantSettings.productTypes,
        entityCode: tenantSettings.entityCode,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)

    const accts = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(
        and(isNull(accounts.deletedAt), ownerScope(accounts.ownerMemberId, visible))
      )
    const accountCodes: Record<string, string> = {}
    for (const a of accts) if (a.code) accountCodes[a.id] = a.code

    return {
      productTypes: s?.productTypes ?? [],
      entityCode: s?.entityCode ?? "",
      year: Number(toDateString().slice(0, 4)),
      accountCodes,
    }
  })
}

export type ProjectPrefill = {
  accountId: string
  accountName: string | null
  value: string
  /** Source deal currency, propagated to the project so it isn't defaulted to MYR. */
  currency: string
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
        currency: opportunities.currency,
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
      currency: opp.currency,
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
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
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
      // Range-check the percentage regardless of whether it drives the amount,
      // so an out-of-range value can't be persisted via a direct action call.
      if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
        throw new Error("Percentage must be between 0 and 100.")
      }

      // Keep amount and percentage consistent: an explicit amount wins and the
      // stored percentage is re-derived from it (against the project value);
      // otherwise the amount is derived from the percentage. This stops the two
      // fields drifting (e.g. "10%" attached to a 50%-of-value amount).
      let amount: string
      let storedPct: number | null
      if (input.amount != null && input.amount !== "") {
        amount = input.amount
        storedPct =
          projectValue > 0
            ? Math.round((Number(amount) / projectValue) * 100 * 100) / 100
            : pct
      } else if (pct != null) {
        amount = (Math.round(projectValue * (pct / 100) * 100) / 100).toFixed(2)
        storedPct = pct
      } else {
        amount = "0"
        storedPct = null
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
          percentage:
            storedPct != null && Number.isFinite(storedPct)
              ? String(storedPct)
              : null,
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

      await writeAudit(tx, ctx, {
        action: "milestone.created",
        entityType: "project",
        entityId: input.projectId,
        after: { milestoneId: row.id, title, amount },
      })
      return row
    }
  )
  revalidatePath(`/projects/${input.projectId}`)
  return created
  })
}

export async function updateMilestone(
  id: string,
  input: MilestoneUpdateInput
): Promise<ActionResult<void>> {
  return runAction(async () => {
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

      // Range-check any incoming percentage (0–100) before it's used.
      const inputPct =
        input.percentage !== undefined && input.percentage
          ? Number(input.percentage)
          : null
      if (
        input.percentage !== undefined &&
        input.percentage &&
        (!Number.isFinite(inputPct) ||
          (inputPct as number) < 0 ||
          (inputPct as number) > 100)
      ) {
        throw new Error("Percentage must be between 0 and 100.")
      }

      // Keep amount and percentage consistent (mirrors createMilestone): an
      // explicit amount edit re-derives the stored percentage from it; a
      // percentage edit re-derives the amount. Untouched fields are preserved.
      let nextAmount: string
      let nextPercentage: string | null
      if (input.amount !== undefined) {
        nextAmount = input.amount ? input.amount : "0"
        nextPercentage =
          projectValue > 0
            ? String(
                Math.round((Number(nextAmount) / projectValue) * 100 * 100) / 100
              )
            : existing.percentage
      } else if (input.percentage !== undefined) {
        nextPercentage = inputPct != null ? String(inputPct) : null
        nextAmount =
          inputPct != null
            ? (Math.round(projectValue * (inputPct / 100) * 100) / 100).toFixed(2)
            : existing.amount
      } else {
        nextAmount = existing.amount
        nextPercentage = existing.percentage
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

      await writeAudit(tx, ctx, {
        action: "milestone.updated",
        entityType: "project",
        entityId: existing.projectId,
        before: { amount: existing.amount, status: existing.status },
        after: { milestoneId: id, amount: nextAmount, status: nextStatus },
      })

      return existing.projectId
    }
  )
  revalidatePath(`/projects/${projectId}`)
  })
}

export async function deleteMilestone(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
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

      await writeAudit(tx, ctx, {
        action: "milestone.deleted",
        entityType: "project",
        entityId: deleted.projectId,
        before: { milestoneId: id, title: deleted.title },
      })
      return deleted.projectId
    }
  )
  revalidatePath(`/projects/${projectId}`)
  })
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
): Promise<ActionResult<void>> {
  return runAction(async () => {
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

    await writeAudit(tx, ctx, {
      action: "milestone.reordered",
      entityType: "project",
      entityId: projectId,
      after: { order },
    })
  })
  revalidatePath(`/projects/${projectId}`)
  })
}
