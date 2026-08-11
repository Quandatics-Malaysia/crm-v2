import "server-only"
import {
  requireContext,
  assertCan,
  type ServerContext,
} from "@/lib/server-context"
import { runInTenant, type Tx } from "@/db"
import type { PermissionKey } from "@/lib/permissions"
import type { ModuleId } from "@/lib/module-registry"
import { withEntitledModule } from "@/lib/modules.server"

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

/**
 * Like `withTenant`, but first asserts signed runtime entitlement. Use for every
 * server action that belongs to an optional module (projects, salesOrders,
 * finance, forecast) so an unlicensed module throws before touching the
 * DB — defense in depth behind the hidden nav and route redirects.
 *
 *   const project = await withModule("projects", PERMISSIONS.PROJECT_CREATE,
 *     (tx, ctx) => tx.insert(projects).values({ ... }).returning())
 */
export async function withModule<T>(
  moduleId: ModuleId,
  permission: PermissionKey,
  fn: (tx: Tx, ctx: ServerContext) => Promise<T>
): Promise<T> {
  return withEntitledModule(moduleId, () => withTenant(permission, fn))
}

export { requireContext, assertCan }
export type { ServerContext, Tx }
