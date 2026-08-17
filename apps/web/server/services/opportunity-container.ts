import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { opportunities, funnels, accounts, tenantSettings } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"
import { toDateString } from "@/lib/dates"
import { formatOpportunityCode, pickPpvvc, type Ppvvc } from "@/lib/opportunity-code"
import { nextProjectCode } from "@/server/services/numbering"

export type NewContainerInput = {
  accountId: string
  ownerMemberId: string
  /** Deprecated display-name input. Opportunity names are always generated. */
  name?: string | null
  /** Container year (drives the per-year running number). Defaults to now. */
  year?: number | null
  currency: string
  description?: string | null
  ppvvc?: Ppvvc | null
  primaryPersonId?: string | null
  /** Primary project nature (tenant picklist) — cascades to the child funnel. */
  projectNatureCode?: string | null
  /** Full set of project natures (first = primary). */
  projectNatures?: string[] | null
}

/** Project-nature fields off any object (for cascading container → funnel,
 *  mirrors {@link pickPpvvc}). */
export function pickNature(src: {
  projectNatureCode?: string | null
  projectNatures?: string[] | null
} | null | undefined): { projectNatureCode: string | null; projectNatures: string[] | null } {
  return {
    projectNatureCode: src?.projectNatureCode ?? null,
    projectNatures: src?.projectNatures ?? null,
  }
}

/**
 * Create an Opportunity CONTAINER with a per-(tenant, year) running number →
 * formulated `code` / `name`. The unique (tenant, year, number) constraint
 * guards against a racing duplicate; callers create the container inside the
 * same tenant tx as the first funnel. Project-code allocation is deliberately
 * deferred until a child funnel enters 4A.
 */
export async function createOpportunityContainer(
  tx: Tx,
  ctx: ServerContext,
  input: NewContainerInput
): Promise<{
  id: string
  accountId: string
  code: string
  ppvvc: Ppvvc
  nature: { projectNatureCode: string | null; projectNatures: string[] | null }
}> {
  const year =
    input.year && input.year > 0
      ? Math.trunc(input.year)
      : Number(toDateString().slice(0, 4))

  const [maxRow] = await tx
    .select({
      max: sql<number>`coalesce(max(${opportunities.opportunityNumber}), 0)`,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, ctx.tenantId),
        eq(opportunities.opportunityYear, year)
      )
    )
  const n = (maxRow?.max ?? 0) + 1
  const [settings] = await tx
    .select({ organizationCode: tenantSettings.entityCode })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, ctx.tenantId))
    .limit(1)
  const code = formatOpportunityCode({
    organizationCode: settings?.organizationCode ?? "",
    year,
    number: n,
  })
  const ppvvc = pickPpvvc(input.ppvvc)
  const nature = pickNature(input)

  const [created] = await tx
    .insert(opportunities)
    .values({
      tenantId: ctx.tenantId,
      accountId: input.accountId,
      primaryPersonId: input.primaryPersonId ?? null,
      ownerMemberId: input.ownerMemberId,
      opportunityYear: year,
      opportunityNumber: n,
      code,
      name: code,
      ...ppvvc,
      ...nature,
      projectCode: null,
      description: input.description ?? null,
      currency: input.currency,
    })
    .returning({ id: opportunities.id, accountId: opportunities.accountId })

  return { id: created.id, accountId: created.accountId, code, ppvvc, nature }
}

/**
 * Allocate an Opportunity's internal project code exactly once. The parent
 * Opportunity is locked inside the caller's stage transaction, so rollback
 * and re-entry return the existing value without consuming another number.
 */
export async function ensureOpportunityProjectCode(
  tx: Tx,
  opportunityId: string,
  context: ServerContext
): Promise<string> {
  const [opportunity] = await tx
    .select({
      projectCode: opportunities.projectCode,
      accountId: opportunities.accountId,
      opportunityYear: opportunities.opportunityYear,
      projectNatureCode: opportunities.projectNatureCode,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.tenantId, context.tenantId)
      )
    )
    .limit(1)
    .for("update")

  if (!opportunity) throw new Error("Opportunity not found")
  if (opportunity.projectCode) return opportunity.projectCode

  const [account] = await tx
    .select({ code: accounts.code })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, opportunity.accountId),
        eq(accounts.tenantId, context.tenantId)
      )
    )
    .limit(1)

  const projectCode = await nextProjectCode(tx, context, {
    accountCode: account?.code ?? "",
    projectNatureCode: opportunity.projectNatureCode ?? "",
    year: opportunity.opportunityYear,
  })
  const [updated] = await tx
    .update(opportunities)
    .set({ projectCode, updatedAt: new Date() })
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.tenantId, context.tenantId),
        isNull(opportunities.projectCode)
      )
    )
    .returning({ projectCode: opportunities.projectCode })

  return updated?.projectCode ?? projectCode
}

/**
 * Recompute a container's Total Estimated Funnel Amount = Σ of its (non-deleted)
 * child funnels' estimatedAmount. Call after any funnel insert/update/soft-delete
 * that changes an estimatedAmount or re-parents a funnel.
 */
export async function recomputeOpportunityTotal(
  tx: Tx,
  tenantId: string,
  opportunityId: string
): Promise<void> {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${funnels.estimatedAmount}), 0)::numeric(14,2)`,
    })
    .from(funnels)
    .where(
      and(
        eq(funnels.tenantId, tenantId),
        eq(funnels.opportunityId, opportunityId),
        isNull(funnels.deletedAt)
      )
    )
  await tx
    .update(opportunities)
    .set({ totalEstimatedFunnelAmount: row?.total ?? "0", updatedAt: new Date() })
    .where(eq(opportunities.id, opportunityId))
}
