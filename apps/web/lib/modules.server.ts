import "server-only"

import { cache } from "react"

import {
  COMPILED_MODULE_MAP,
  MODULES,
  createDisabledModuleMap,
  createModuleMap,
  type ModuleId,
  type ModuleMap,
} from "@/lib/module-registry"
import {
  getDeploymentAccess,
  type DeploymentAccess,
} from "@/lib/deployment-control"

export class ModuleAccessDeniedError extends Error {
  readonly moduleId: ModuleId

  constructor(moduleId: ModuleId) {
    super(`The ${MODULES[moduleId].label} module is not licensed.`)
    this.name = "ModuleAccessDeniedError"
    this.moduleId = moduleId
  }
}

export function createEntitledModuleGate(
  readAccess: () => Promise<Pick<DeploymentAccess, "moduleIds">>,
  compiled: ModuleMap = COMPILED_MODULE_MAP
) {
  async function getEntitledModuleMap(): Promise<ModuleMap> {
    let access: Pick<DeploymentAccess, "moduleIds">
    try {
      access = await readAccess()
    } catch {
      return createDisabledModuleMap()
    }

    const missing = access.moduleIds.find((id: ModuleId) => !compiled[id])
    if (missing) {
      throw new Error(
        `Signed entitlement owns module "${missing}", but the image omits it.`
      )
    }
    return createModuleMap(access.moduleIds, compiled)
  }

  async function requireEntitledModule(id: ModuleId): Promise<void> {
    const modules = await getEntitledModuleMap()
    if (!modules[id]) throw new ModuleAccessDeniedError(id)
  }

  async function withEntitledModule<T>(
    id: ModuleId,
    work: () => Promise<T> | T
  ): Promise<T> {
    await requireEntitledModule(id)
    return work()
  }

  return { getEntitledModuleMap, requireEntitledModule, withEntitledModule }
}

const runtimeGate = createEntitledModuleGate(() => getDeploymentAccess())

// React cache deduplicates only within the current Server Component request.
// It is intentionally not a Next cache or a process-global entitlement cache.
const getRequestModuleMap = cache(runtimeGate.getEntitledModuleMap)

export function getEntitledModuleMap(): Promise<ModuleMap> {
  return getRequestModuleMap()
}

export async function requireEntitledModule(id: ModuleId): Promise<void> {
  const modules = await getRequestModuleMap()
  if (!modules[id]) throw new ModuleAccessDeniedError(id)
}

export async function withEntitledModule<T>(
  id: ModuleId,
  work: () => Promise<T> | T
): Promise<T> {
  await requireEntitledModule(id)
  return work()
}
