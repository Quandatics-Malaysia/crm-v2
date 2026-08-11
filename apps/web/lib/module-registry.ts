import { MODULE_CONFIG } from "@/modules.config"

export const MODULE_IDS = [
  "projects",
  "salesOrders",
  "finance",
  "forecast",
  "audit",
  "advancedRoles",
  "documentation",
] as const

export type ModuleId = (typeof MODULE_IDS)[number]
export type ModuleMap = Record<ModuleId, boolean>

export type ModuleMeta = {
  id: ModuleId
  label: string
  dependsOn: ModuleId[]
}

export const MODULES: Record<ModuleId, ModuleMeta> = {
  projects: { id: "projects", label: "Projects", dependsOn: [] },
  salesOrders: { id: "salesOrders", label: "Sales Orders", dependsOn: ["projects"] },
  finance: { id: "finance", label: "Billing & Purchasing", dependsOn: ["projects", "salesOrders"] },
  forecast: { id: "forecast", label: "Forecast", dependsOn: [] },
  audit: { id: "audit", label: "Audit log", dependsOn: [] },
  advancedRoles: { id: "advancedRoles", label: "Advanced roles", dependsOn: [] },
  documentation: { id: "documentation", label: "Documentation", dependsOn: [] },
}

export const COMPILED_MODULE_MAP: ModuleMap = Object.fromEntries(
  MODULE_IDS.map((id) => [id, MODULE_CONFIG[id] === true])
) as ModuleMap

export function createDisabledModuleMap(): ModuleMap {
  return Object.fromEntries(MODULE_IDS.map((id) => [id, false])) as ModuleMap
}

export function isDependencyClosed(ids: readonly ModuleId[]): boolean {
  const enabled = new Set(ids)
  return ids.every((id) =>
    MODULES[id].dependsOn.every((dependency) => enabled.has(dependency))
  )
}

export function createModuleMap(
  entitledIds: readonly ModuleId[],
  compiled: ModuleMap = COMPILED_MODULE_MAP
): ModuleMap {
  if (!isDependencyClosed(entitledIds)) return createDisabledModuleMap()
  const entitled = new Set(entitledIds)
  const moduleMap = Object.fromEntries(
    MODULE_IDS.map((id) => [id, entitled.has(id) && compiled[id]])
  ) as ModuleMap

  const effectiveIds = MODULE_IDS.filter((id) => moduleMap[id])
  return isDependencyClosed(effectiveIds)
    ? moduleMap
    : createDisabledModuleMap()
}

export function filterPermissionGroups<T extends { module?: ModuleId }>(
  groups: readonly T[],
  modules: ModuleMap
): T[] {
  return groups.filter((group) => !group.module || modules[group.module])
}

/** Validates build composition only. It never grants runtime access. */
export function validateModuleComposition(): string[] {
  const compiled = MODULE_IDS.filter((id) => COMPILED_MODULE_MAP[id])
  if (isDependencyClosed(compiled)) return []

  const enabled = new Set(compiled)
  const errors: string[] = []
  for (const id of compiled) {
    for (const dependency of MODULES[id].dependsOn) {
      if (!enabled.has(dependency)) {
        errors.push(
          `Module "${id}" is compiled but its dependency "${dependency}" is omitted.`
        )
      }
    }
  }
  return errors
}
