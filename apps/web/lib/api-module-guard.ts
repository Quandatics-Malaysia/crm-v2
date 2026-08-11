import "server-only"

import type { ModuleId } from "@/lib/module-registry"
import { requireEntitledModule } from "@/lib/modules.server"

export async function withApiResourceEntitlement<T>(
  resource: { module?: ModuleId },
  work: () => Promise<T> | T,
  requireModule: (id: ModuleId) => Promise<void> = requireEntitledModule
): Promise<T> {
  if (resource.module) await requireModule(resource.module)
  return work()
}
