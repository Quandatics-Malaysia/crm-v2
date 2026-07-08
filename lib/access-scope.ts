import "server-only"
import { eq, inArray, sql, type SQL, type Column } from "drizzle-orm"
import { type Tx } from "@/db"
import {
  membershipProfiles,
  accounts,
  leads,
  funnels,
  projects,
  persons,
  quotations,
  salesOrders,
  stageApprovalRequests,
} from "@/db/schema"
import { PERMISSIONS } from "@/lib/permissions"
import { isModuleEnabled } from "@/lib/modules"
import { type ServerContext } from "@/lib/server-context"

/**
 * Record-level access: owner + managed-subtree, with elevation.
 *
 * A member sees the records they own plus those owned by anyone in their
 * management subtree (transitive reports via `managerMemberId`). Holding
 * `records.view_all` (or being a superadmin) removes the owner filter entirely;
 * `records.manage_all` does the same for edit/delete. Tenant isolation still
 * comes from RLS — this layer narrows within a tenant.
 */

export function canViewAllRecords(ctx: ServerContext): boolean {
  return ctx.isSuperadmin || ctx.can(PERMISSIONS.RECORDS_VIEW_ALL)
}

export function canManageAllRecords(ctx: ServerContext): boolean {
  return ctx.isSuperadmin || ctx.can(PERMISSIONS.RECORDS_MANAGE_ALL)
}

/**
 * Member ids whose records `ctx` may see: self + transitive reports. Returns
 * `null` when the user may see everything (view-all / superadmin) — callers
 * treat null as "no owner filter". Returns `[]` when the user has no membership
 * (sees nothing of their own).
 */
export async function visibleMemberIds(
  tx: Tx,
  ctx: ServerContext
): Promise<string[] | null> {
  if (canViewAllRecords(ctx)) return null
  if (!ctx.memberId) return []

  const rows = await tx
    .select({
      memberId: membershipProfiles.memberId,
      managerId: membershipProfiles.managerMemberId,
    })
    .from(membershipProfiles)

  const childrenOf = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.managerId) continue
    const arr = childrenOf.get(r.managerId)
    if (arr) arr.push(r.memberId)
    else childrenOf.set(r.managerId, [r.memberId])
  }

  const visible = new Set<string>([ctx.memberId])
  const stack = [ctx.memberId]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const child of childrenOf.get(cur) ?? []) {
      if (!visible.has(child)) {
        visible.add(child)
        stack.push(child)
      }
    }
  }
  return [...visible]
}

/**
 * A WHERE predicate restricting `ownerColumn` to the visible member set:
 * `undefined` for view-all (no filter), an `inArray`, or a fail-closed `false`
 * when the user may see nothing. Compose with `and(...)` alongside existing
 * conditions.
 */
export function ownerScope(
  ownerColumn: Column,
  visible: string[] | null
): SQL | undefined {
  if (visible === null) return undefined
  if (visible.length === 0) return sql`false`
  return inArray(ownerColumn, visible)
}

/**
 * True if `ctx` may act on a record owned by `ownerMemberId` under `visible`
 * (own + subtree). Use for detail reads and ownership-scoped mutations after
 * loading the record's owner.
 */
export function ownsOrManages(
  visible: string[] | null,
  ownerMemberId: string | null
): boolean {
  if (visible === null) return true
  if (!ownerMemberId) return false
  return visible.includes(ownerMemberId)
}

/**
 * Resolve the owning member of the record an attachment hangs off, following
 * the parent FK for entities that don't carry an owner column themselves.
 * Returns null when the parent is missing or has no owner (fails closed).
 */
export async function attachableOwner(
  tx: Tx,
  type: string,
  id: string
): Promise<string | null> {
  switch (type) {
    case "account": {
      const [r] = await tx
        .select({ o: accounts.ownerMemberId })
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "lead": {
      const [r] = await tx
        .select({ o: leads.ownerMemberId })
        .from(leads)
        .where(eq(leads.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "opportunity": {
      const [r] = await tx
        .select({ o: funnels.ownerMemberId })
        .from(funnels)
        .where(eq(funnels.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "project": {
      const [r] = await tx
        .select({ o: projects.ownerMemberId })
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "person": {
      const [r] = await tx
        .select({ o: accounts.ownerMemberId })
        .from(persons)
        .innerJoin(accounts, eq(persons.accountId, accounts.id))
        .where(eq(persons.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "quotation": {
      const [r] = await tx
        .select({ o: funnels.ownerMemberId })
        .from(quotations)
        .innerJoin(
          funnels,
          eq(quotations.funnelId, funnels.id)
        )
        .where(eq(quotations.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "sales_order": {
      const [r] = await tx
        .select({ o: projects.ownerMemberId })
        .from(salesOrders)
        .innerJoin(projects, eq(salesOrders.projectId, projects.id))
        .where(eq(salesOrders.id, id))
        .limit(1)
      return r?.o ?? null
    }
    case "stage_approval_request": {
      const [r] = await tx
        .select({ o: funnels.ownerMemberId })
        .from(stageApprovalRequests)
        .innerJoin(
          funnels,
          eq(stageApprovalRequests.funnelId, funnels.id)
        )
        .where(eq(stageApprovalRequests.id, id))
        .limit(1)
      return r?.o ?? null
    }
    default:
      return null
  }
}

/**
 * Whether `ctx` may view/manage the record an attachment belongs to. View also
 * lets a sales-order approver see SO proof documents (mirrors the SO list
 * bypass); manage never does. Used by the attachment actions + download route.
 */
export async function canAccessAttachable(
  tx: Tx,
  ctx: ServerContext,
  type: string,
  id: string,
  mode: "view" | "manage"
): Promise<boolean> {
  // Finance documents carry no owner — access is purely capability-based
  // (finance.view / finance.manage, already asserted by the caller via
  // ATTACH_PERMS) within the RLS-scoped tenant. The module flag still
  // applies: with the add-on off, its attachments/activity are off too.
  if (type === "finance_doc") {
    return isModuleEnabled("finance")
  }
  if (mode === "view" && canViewAllRecords(ctx)) return true
  if (mode === "manage" && canManageAllRecords(ctx)) return true
  if (
    mode === "view" &&
    type === "sales_order" &&
    ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)
  ) {
    return true
  }
  const owner = await attachableOwner(tx, type, id)
  const visible = await visibleMemberIds(tx, ctx)
  return ownsOrManages(visible, owner)
}
