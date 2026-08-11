import "server-only"
import { redirect } from "next/navigation"
import type { ModuleId } from "@/lib/module-registry"
import { requireEntitledModule } from "@/lib/modules.server"

/**
 * RSC / layout guard: redirect to the dashboard when signed entitlement does
 * not include the route's module. Kept in its own tiny server-only file
 * so pages don't transitively pull the `db` graph via `lib/actions.ts` just to
 * gate a route.
 *
 *   export default async function Page() {
 *     await requireEntitledRoute("projects")
 *     ...
 *   }
 */
export function createModuleRouteGuard(
  requireModule: (id: ModuleId) => Promise<void>,
  deny: (path: string) => unknown
) {
  return async function requireRoute(id: ModuleId): Promise<void> {
    try {
      await requireModule(id)
    } catch {
      deny("/dashboard")
    }
  }
}

export const requireEntitledRoute = createModuleRouteGuard(
  requireEntitledModule,
  redirect
)
