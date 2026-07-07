import "server-only"
import {
  requireContext,
  assertCan,
  type ServerContext,
} from "@/lib/server-context"
import { runInTenant, type Tx } from "@/db"
import type { PermissionKey } from "@/lib/permissions"
import { assertModuleEnabled, type ModuleId } from "@/lib/modules"

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
 * Like `withTenant`, but first asserts that a plugin is enabled. Use for every
 * server action that belongs to an optional module (projects, salesOrders,
 * finance, forecast) so a disabled plugin's actions throw before touching the
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
  assertModuleEnabled(moduleId)
  return withTenant(permission, fn)
}

export { requireContext, assertCan }
export type { ServerContext, Tx }
