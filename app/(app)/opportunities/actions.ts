"use server"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { writeAudit } from "@/server/audit"
import {
  visibleMemberIds,
  ownerScope,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import {
  opportunities,
  funnels,
  pipelineStages,
  quotations,
  opportunityProducts,
  accounts,
  persons,
  member,
  user,
} from "@/db/schema"

/** A resolved contact for display: name + derived "Designation" (persons.title). */
export type ContactRef = { id: string; name: string; designation: string | null }

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
  /** Opportunity Owner Contact, resolved with its derived Designation. */
  ownerContact: ContactRef | null
  /** Power Sponsor Contact, resolved with its derived Designation. */
  powerSponsorContact: ContactRef | null
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

    // Owner/Power Sponsor Contact — resolved with "Designation" (a Salesforce
    // formula field derived live from persons.title, never stored).
    async function resolveContact(personId: string | null): Promise<ContactRef | null> {
      if (!personId) return null
      const [p] = await tx
        .select({ firstName: persons.firstName, lastName: persons.lastName, title: persons.title })
        .from(persons)
        .where(eq(persons.id, personId))
        .limit(1)
      if (!p) return null
      return {
        id: personId,
        name: [p.firstName, p.lastName].filter(Boolean).join(" "),
        designation: p.title,
      }
    }
    const [ownerContact, powerSponsorContact] = await Promise.all([
      resolveContact(opp.ownerContactId),
      resolveContact(opp.powerSponsorContactId),
    ])

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
      ownerContact,
      powerSponsorContact,
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

export type OpportunityContainerUpdateInput = {
  name?: string
  description?: string | null
  // PPVVC "Analysis" block — source of truth on the container, cascaded to
  // every non-deleted child funnel (same pattern as project nature below).
  pain?: string | null
  power?: string | null
  vision?: string | null
  value?: string | null
  control?: string | null
  projectNatureCode?: string | null
  projectNatures?: string[] | null
  ownerContactId?: string | null
  ownerBudgetLimit?: string | null
  powerSponsorContactId?: string | null
  powerSponsorBudgetLimit?: string | null
  estimatedBudget?: string | null
  estimatedCloseDate?: string | null
  isRenewal?: boolean
  showDashboards?: boolean
  assignedPresales?: string | null
  competitor?: string | null
}

/**
 * Update an Opportunity container. PPVVC + project nature cascade to every
 * non-deleted child funnel (they're the source of truth here, same as at
 * container-creation time) — everything else is container-only.
 */
export async function updateOpportunityContainer(
  id: string,
  input: OpportunityContainerUpdateInput
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await withTenant(PERMISSIONS.OPPORTUNITY_UPDATE, async (tx, ctx) => {
      const [existing] = await tx
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
        .limit(1)
      if (!existing) throw new Error("Opportunity not found")

      const visible = await visibleMemberIds(tx, ctx)
      if (!canManageAllRecords(ctx) && !ownsOrManages(visible, existing.ownerMemberId)) {
        throw new Error("FORBIDDEN: not permitted on this Opportunity")
      }

      const cascade = {
        pain: input.pain === undefined ? existing.pain : input.pain || null,
        power: input.power === undefined ? existing.power : input.power || null,
        vision: input.vision === undefined ? existing.vision : input.vision || null,
        value: input.value === undefined ? existing.value : input.value || null,
        control: input.control === undefined ? existing.control : input.control || null,
        projectNatureCode:
          input.projectNatures !== undefined
            ? (input.projectNatures?.[0] ?? null)
            : input.projectNatureCode === undefined
              ? existing.projectNatureCode
              : input.projectNatureCode || null,
        projectNatures:
          input.projectNatures === undefined
            ? existing.projectNatures
            : input.projectNatures && input.projectNatures.length
              ? input.projectNatures
              : null,
      }

      await tx
        .update(opportunities)
        .set({
          name: input.name?.trim() || existing.name,
          description:
            input.description === undefined ? existing.description : input.description || null,
          ...cascade,
          ownerContactId:
            input.ownerContactId === undefined
              ? existing.ownerContactId
              : input.ownerContactId || null,
          ownerBudgetLimit:
            input.ownerBudgetLimit === undefined
              ? existing.ownerBudgetLimit
              : input.ownerBudgetLimit || null,
          powerSponsorContactId:
            input.powerSponsorContactId === undefined
              ? existing.powerSponsorContactId
              : input.powerSponsorContactId || null,
          powerSponsorBudgetLimit:
            input.powerSponsorBudgetLimit === undefined
              ? existing.powerSponsorBudgetLimit
              : input.powerSponsorBudgetLimit || null,
          estimatedBudget:
            input.estimatedBudget === undefined
              ? existing.estimatedBudget
              : input.estimatedBudget || null,
          estimatedCloseDate:
            input.estimatedCloseDate === undefined
              ? existing.estimatedCloseDate
              : input.estimatedCloseDate || null,
          isRenewal: input.isRenewal ?? existing.isRenewal,
          showDashboards: input.showDashboards ?? existing.showDashboards,
          assignedPresales:
            input.assignedPresales === undefined
              ? existing.assignedPresales
              : input.assignedPresales || null,
          competitor:
            input.competitor === undefined ? existing.competitor : input.competitor || null,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.id, id))

      // Cascade PPVVC + nature to every non-deleted child funnel — they're
      // read-only copies for display/gating, this container is the source.
      await tx
        .update(funnels)
        .set({
          pain: cascade.pain,
          power: cascade.power,
          vision: cascade.vision,
          value: cascade.value,
          control: cascade.control,
          projectNatureCode: cascade.projectNatureCode,
          projectNatures: cascade.projectNatures,
          updatedAt: new Date(),
        })
        .where(and(eq(funnels.opportunityId, id), isNull(funnels.deletedAt)))

      await writeAudit(tx, ctx, {
        action: "opportunity_container.updated",
        entityType: "opportunity_container",
        entityId: id,
        before: {
          ownerBudgetLimit: existing.ownerBudgetLimit,
          powerSponsorBudgetLimit: existing.powerSponsorBudgetLimit,
          estimatedBudget: existing.estimatedBudget,
        },
        after: {
          ownerBudgetLimit:
            input.ownerBudgetLimit === undefined ? existing.ownerBudgetLimit : input.ownerBudgetLimit,
          powerSponsorBudgetLimit:
            input.powerSponsorBudgetLimit === undefined
              ? existing.powerSponsorBudgetLimit
              : input.powerSponsorBudgetLimit,
          estimatedBudget:
            input.estimatedBudget === undefined ? existing.estimatedBudget : input.estimatedBudget,
        },
      })
    })
    revalidatePath(`/opportunities/${id}`)
  })
}
