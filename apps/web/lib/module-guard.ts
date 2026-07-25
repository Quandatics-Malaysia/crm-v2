import "server-only"
import { redirect } from "next/navigation"
import { isModuleEnabled, type ModuleId } from "@/lib/modules"

/**
 * RSC / layout guard: redirect to the dashboard when a plugin's route is
 * reached while the plugin is disabled. Kept in its own tiny server-only file
 * so pages don't transitively pull the `db` graph via `lib/actions.ts` just to
 * gate a route.
 *
 *   export default async function Page() {
 *     requireModule("projects")
 *     ...
 *   }
 */
export function requireModule(id: ModuleId): void {
  if (!isModuleEnabled(id)) redirect("/dashboard")
}
