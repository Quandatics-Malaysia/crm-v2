"use server"

import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { runAction, type ActionResult } from "@/lib/action-result"
import { recordChanges } from "@/server/services/changes/record"
import { opportunitiesList, opportunitiesGet } from "@/lib/api-readers"
import {
  visibleMemberIds,
  ownsOrManages,
  canManageAllRecords,
} from "@/lib/access-scope"
import { opportunities, funnels } from "@/db/schema"
import {
  recordPpvvcSyncChanges,
  updateOpportunityPpvvc,
} from "@/server/services/ppvvc"
import type { PpvvcValues } from "@/lib/ppvvc"

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

// The original query had no .limit() — every visible container was returned.
// Preserve that by passing an effectively-unbounded page to the shared reader.
const UNBOUNDED_LIMIT = 1_000_000

/** All Opportunity containers visible to the caller, with funnel counts. */
export async function listOpportunities(): Promise<OpportunityContainerRow[]> {
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, async (tx, ctx) => {
    const { rows } = await opportunitiesList(tx, ctx, {
      limit: UNBOUNDED_LIMIT,
      offset: 0,
    })
    return rows
  })
}

export type OpportunityContainerDetail = {
  opportunity: typeof opportunities.$inferSelect
  accountId: string
  accountName: string
  accountCurrency: string
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
  return withTenant(PERMISSIONS.OPPORTUNITY_VIEW, (tx, ctx) => opportunitiesGet(tx, ctx, id))
}

export type OpportunityContainerUpdateInput = {
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

      const nextPpvvc: PpvvcValues = {
        pain: input.pain === undefined ? existing.pain : input.pain || null,
        power: input.power === undefined ? existing.power : input.power || null,
        vision: input.vision === undefined ? existing.vision : input.vision || null,
        value: input.value === undefined ? existing.value : input.value || null,
        control: input.control === undefined ? existing.control : input.control || null,
      }
      const cascade = {
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

      const updated = {
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
      }

      const hasPpvvcInput = Object.keys(nextPpvvc).some(
        (key) => input[key as keyof OpportunityContainerUpdateInput] !== undefined
      )
      const syncedPpvvc = hasPpvvcInput
        ? await updateOpportunityPpvvc(tx, {
            opportunityId: id,
            tenantId: ctx.tenantId,
            values: nextPpvvc,
            actorId: ctx.userId,
          })
        : null
      if (syncedPpvvc) await recordPpvvcSyncChanges(tx, ctx, syncedPpvvc)

      await tx.update(opportunities).set(updated).where(eq(opportunities.id, id))

      // Project nature remains a compatibility snapshot on live child Funnels;
      // PPVVC snapshots are maintained only by updateOpportunityPpvvc above.
      await tx
        .update(funnels)
        .set({
          projectNatureCode: cascade.projectNatureCode,
          projectNatures: cascade.projectNatures,
          updatedAt: new Date(),
        })
        .where(and(eq(funnels.opportunityId, id), isNull(funnels.deletedAt)))

      await recordChanges(tx, ctx, {
        entityType: "opportunity",
        registryKey: "opportunity",
        entityId: id,
        before: existing,
        after: { ...existing, ...updated },
        subject: "Opportunity updated",
      })
    })
    revalidatePath(`/opportunities/${id}`)
  })
}
