import "server-only"
import {
  requireContext,
  assertCan,
  type ServerContext,
} from "@/lib/server-context"
import { runInTenant, type Tx } from "@/db"
import type { PermissionKey } from "@/lib/permissions"

/**
 * Standard server-action wrapper: authenticate → authorize → open a
 * tenant-scoped transaction (RLS GUC set). Use for every mutation/read that
 * touches tenant data.
 *
 *   const lead = await withTenant(PERMISSIONS.LEAD_CREATE, (tx, ctx) =>
 *     tx.insert(leads).values({ tenantId: ctx.tenantId, ... }).returning()
 *   )
 */
export async function withTenant<T>(
  permission: PermissionKey,
  fn: (tx: Tx, ctx: ServerContext) => Promise<T>
): Promise<T> {
  const ctx = await requireContext()
  assertCan(ctx, permission)
  return runInTenant(ctx.tenantId, (tx) => fn(tx, ctx))
}

export { requireContext, assertCan }
export type { ServerContext, Tx }
