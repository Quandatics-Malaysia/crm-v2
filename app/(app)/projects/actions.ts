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
  intercompanyDeals,
} from "@/db/schema"
import { toDateString } from "@/lib/dates"
import { nextProjectCode, isDuplicateNumberError } from "@/server/services/numbering"
import { tenantDefaultCurrency } from "@/server/services/tenant-currency"
import { logActivity } from "@/server/services/activity"
import { maybeCompleteProject } from "@/server/services/finance"
import { opportunityNetValue } from "@/server/services/value"
import { splitMilestones } from "@/lib/milestone-split"
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
  /** Whether the caller may edit this project — mirrors updateProject's own
   *  ownership check, so the Edit button never appears only to be denied. */
  canEdit: boolean
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
   * Project-nature code chosen from the tenant's product_types picklist. Used as
   * the PROJECTNATURE segment of an auto-generated code and snapshotted onto the
   * project so its code stays stable if the picklist later changes.
   */
  projectNatureCode?: string
  /**
   * Set when this project delivers an INBOUND intercompany deal (the current
   * tenant is the handling partner). Validated to be a deal actually assigned
   * to this tenant.
   */
  intercompanyDealId?: string | null
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
      canEdit:
        canManageAllRecords(ctx) ||
        ownsOrManages(visible, row.project.ownerMemberId),
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

      // An intercompany-delivery project must reference a deal actually
      // assigned to THIS tenant as handling partner (the two-sided RLS lets
      // us read it; the partner predicate pins the direction).
      if (input.intercompanyDealId) {
        const [deal] = await tx
          .select({ id: intercompanyDeals.id })
          .from(intercompanyDeals)
          .where(
            and(
              eq(intercompanyDeals.id, input.intercompanyDealId),
              eq(intercompanyDeals.partnerTenantId, ctx.tenantId)
            )
          )
          .limit(1)
        if (!deal)
          throw new Error(
            "The intercompany deal was not found or is not assigned to this entity."
          )
      }

      // Default to "auto" so the funnel "create project" path (and any caller
      // that omits codeNature) keeps auto-generating as before.
      const codeNature: ProjectCodeNature =
        input.codeNature === "manual" ? "manual" : "auto"

      // Snapshotted onto the project (both natures) so the resolved project-nature
      // code stays stable even if the tenant later edits its picklist. Derived
      // upstream from the source quotation/funnel; fall back to a safe "GEN"
      // rather than blocking when nothing resolved (matches nextProjectCode).
      const projectNatureCode = (input.projectNatureCode ?? "").trim() || "GEN"

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
          projectNatureCode,
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
            projectNatureCode: projectNatureCode || null,
            name: input.name,
            accountId: input.accountId,
            opportunityId: input.opportunityId || null,
            quotationId: input.quotationId || null,
            intercompanyDealId: input.intercompanyDealId || null,
            ownerMemberId: ctx.memberId,
            status: isStatus(input.status) ? input.status : "planning",
            value: input.value ? input.value : null,
            // Carry the source deal currency through; fall back to the tenant's
            // configured default currency (not a hardcoded MYR) when the caller
            // has none to propagate.
            currency:
              input.currency || (await tenantDefaultCurrency(tx, ctx.tenantId)),
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

      // Automation: seed payment milestones from the tenant template when the
      // project starts with a value (Settings → Numbering). Split math lives
      // in lib/milestone-split.ts (pure + unit-tested).
      const projectValue = Number(input.value ?? 0)
      if (projectValue > 0) {
        const [s] = await tx
          .select({ template: tenantSettings.milestoneTemplate })
          .from(tenantSettings)
          .where(eq(tenantSettings.organizationId, ctx.tenantId))
          .limit(1)
        const seeded = splitMilestones(projectValue, s?.template ?? [])
        if (seeded.length > 0) {
          await tx.insert(paymentMilestones).values(
            seeded.map((m) => ({
              tenantId: ctx.tenantId,
              projectId: row.id,
              quotationId: input.quotationId || null,
              ...m,
            }))
          )
        }
      }
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

export type QuotationLinkOption = {
  id: string
  quoteNumber: string
  status: string
  total: string
  currency: string
  isPrimary: boolean
}

/** Quotations under an opportunity, offered as link targets in the project
 *  edit dialog. A quotation belongs to one opportunity, so the pickable set is
 *  the project's own funnel; RLS already scopes to this tenant. Primary first. */
export async function listQuotationLinkOptions(
  opportunityId: string
): Promise<QuotationLinkOption[]> {
  return withTenant(PERMISSIONS.PROJECT_UPDATE, async (tx) => {
    return tx
      .select({
        id: quotations.id,
        quoteNumber: quotations.quoteNumber,
        status: quotations.status,
        total: quotations.total,
        currency: quotations.currency,
        isPrimary: quotations.isPrimary,
      })
      .from(quotations)
      .where(
        and(
          eq(quotations.opportunityId, opportunityId),
          isNull(quotations.deletedAt)
        )
      )
      .orderBy(desc(quotations.isPrimary), asc(quotations.quoteNumber))
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

export type ProjectNatureOption = { code: string; name: string }

export type ProjectCreateMeta = {
  /** Tenant-managed project-nature picklist for the required Project Nature field. */
  projectNatures: ProjectNatureOption[]
  /** ENTITY segment of the project code (tenant_settings.entityCode). */
  entityCode: string
  /** Current local calendar year — the YYYY segment of the live code preview. */
  year: number
  /** Visible accounts' short codes, keyed by account id, for the live preview. */
  accountCodes: Record<string, string>
}

/**
 * Bundle of tenant data the create form needs to render the Project Nature picker
 * and the live project-code preview ({YYYY}-{ENTITY}-{ACCOUNTCODE}-{TYPE}-###).
 */
export async function listProjectCreateMeta(): Promise<ProjectCreateMeta> {
  return withTenant(PERMISSIONS.PROJECT_CREATE, async (tx, ctx) => {
    const visible = await visibleMemberIds(tx, ctx)
    const [s] = await tx
      .select({
        projectNatures: tenantSettings.projectNatures,
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
      projectNatures: s?.projectNatures ?? [],
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
  /**
   * Project-nature code DERIVED for the project, snapshotted from the source
   * quotation when present, else the funnel's default, else the tenant's first
   * project nature. Empty string when nothing resolves (form treats it as a
   * prefilled-but-editable suggestion; createProject defaults to "GEN").
   */
  projectNatureCode: string
}

/**
 * Prefill a new project from a funnel (opportunity). Value, quotationId and
 * quoteNumber are derived from the opportunity's net (ex-tax) deal value via
 * the shared value service — i.e. the source quotation. The account is read
 * from the opportunity so the form can preselect it. The project-nature code is
 * derived from that source quotation (fallback: the funnel's product_type_code,
 * then the tenant's first project nature) so the form prefills it editable.
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
        projectNatureCode: opportunities.projectNatureCode,
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

    // Derive the project nature: the accepted/source quotation snapshot wins, then
    // the funnel's default, then the tenant's first configured project nature.
    let projectNatureCode: string | null = null
    if (fromQuoteId) {
      const [q] = await tx
        .select({ code: quotations.projectNatureCode })
        .from(quotations)
        .where(eq(quotations.id, fromQuoteId))
        .limit(1)
      projectNatureCode = q?.code ?? null
    }
    if (!projectNatureCode) projectNatureCode = opp.projectNatureCode ?? null
    if (!projectNatureCode) {
      const [s] = await tx
        .select({ projectNatures: tenantSettings.projectNatures })
        .from(tenantSettings)
        .where(eq(tenantSettings.organizationId, ctx.tenantId))
        .limit(1)
      projectNatureCode = s?.projectNatures?.[0]?.code ?? null
    }

    return {
      accountId: opp.accountId,
      accountName: opp.accountName,
      value,
      currency: opp.currency,
      quotationId: fromQuoteId,
      quoteNumber,
      opportunityName: opp.name,
      projectNatureCode: projectNatureCode ?? "",
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
  dueDate: string | null
  status: MilestoneStatus
  sortOrder: number
}

export type MilestoneCreateInput = {
  projectId: string
  title: string
  amount?: string | null
  dueDate?: string | null
}

export type MilestoneUpdateInput = {
  title?: string
  amount?: string | null
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
      // Milestones are split by exact amount.
      const amount = input.amount != null && input.amount !== "" ? input.amount : "0"

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

      // Milestones are split by exact amount; an untouched amount is preserved.
      const nextAmount =
        input.amount === undefined
          ? existing.amount
          : input.amount
            ? input.amount
            : "0"

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

      // Manually marking the last milestone paid completes the project too
      // (same automation as the receipt path; toggle-gated inside).
      if (nextStatus === "paid" && nextStatus !== existing.status) {
        await maybeCompleteProject(tx, ctx, existing.projectId)
      }

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

      // Deleting the last unpaid milestone can leave everything paid.
      await maybeCompleteProject(tx, ctx, deleted.projectId)

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
