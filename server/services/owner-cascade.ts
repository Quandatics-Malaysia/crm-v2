import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { Tx } from "@/db"
import { persons, funnels, opportunities } from "@/db/schema"

/**
 * Salesforce-style owner cascade ("Map Account Owner to Contact Owner,
 * Opportunity Owner and Funnel Owner"): when an account's owner changes, its
 * owned children must follow so record-scoped access stays consistent.
 *
 * In this CRM the children that carry an owner and an accountId are persons,
 * opportunities, and funnels. Quotes/milestones have no owner (they inherit
 * access via the funnel) so nothing cascades to them. There is no Sales-Admin
 * role, so — unlike SF — the cascade is unconditional.
 *
 * Runs inside the caller's transaction so the reassignment is atomic with the
 * account update. Only touches non-deleted rows (all three tables soft-delete).
 * Returns the number of rows updated per child table (useful for auditing).
 */
export async function cascadeAccountOwner(
  tx: Tx,
  tenantId: string,
  accountId: string,
  newOwnerMemberId: string
): Promise<{ persons: number; opportunities: number; funnels: number }> {
  const updatedPersons = await tx
    .update(persons)
    .set({ ownerMemberId: newOwnerMemberId })
    .where(
      and(
        eq(persons.tenantId, tenantId),
        eq(persons.accountId, accountId),
        isNull(persons.deletedAt)
      )
    )
    .returning({ id: persons.id })

  const updatedOpportunities = await tx
    .update(opportunities)
    .set({ ownerMemberId: newOwnerMemberId })
    .where(
      and(
        eq(opportunities.tenantId, tenantId),
        eq(opportunities.accountId, accountId),
        isNull(opportunities.deletedAt)
      )
    )
    .returning({ id: opportunities.id })

  const updatedFunnels = await tx
    .update(funnels)
    .set({ ownerMemberId: newOwnerMemberId })
    .where(
      and(
        eq(funnels.tenantId, tenantId),
        eq(funnels.accountId, accountId),
        isNull(funnels.deletedAt)
      )
    )
    .returning({ id: funnels.id })

  return {
    persons: updatedPersons.length,
    opportunities: updatedOpportunities.length,
    funnels: updatedFunnels.length,
  }
}
