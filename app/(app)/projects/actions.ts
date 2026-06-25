"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import {
  projects,
  projectStatus,
  accounts,
  opportunities,
  quotations,
  member,
  user,
} from "@/db/schema"
import { nextProjectCode } from "@/server/services/numbering"
import { logActivity } from "@/server/services/activity"
import { opportunityNetValue } from "@/server/services/value"

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

export type ProjectCreateInput = {
  name: string
  accountId: string
  opportunityId?: string
  quotationId?: string
  value?: string
  startDate?: string
  status?: string
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
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx) => {
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
      .where(isNull(projects.deletedAt))
      .orderBy(desc(projects.createdAt))
    return rows
  })
}

/** Full detail for one project with linked account / funnel / quotation / owner. */
export async function getProject(id: string): Promise<ProjectDetail | null> {
  return withTenant(PERMISSIONS.PROJECT_VIEW, async (tx) => {
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

      const projectCode = await nextProjectCode(tx, ctx, acct.code ?? "")

      const [row] = await tx
        .insert(projects)
        .values({
          tenantId: ctx.tenantId,
          projectCode,
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
  return withTenant(PERMISSIONS.PROJECT_VIEW, (tx) =>
    tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
      })
      .from(opportunities)
      .where(isNull(opportunities.deletedAt))
      .orderBy(asc(opportunities.name))
  )
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
  return withTenant(PERMISSIONS.PROJECT_CREATE, async (tx) => {
    const [opp] = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        accountId: opportunities.accountId,
        accountName: accounts.name,
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
