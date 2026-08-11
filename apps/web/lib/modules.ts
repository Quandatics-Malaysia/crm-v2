/** Client-safe module catalog compatibility exports. Runtime access lives in modules.server.ts. */
export {
  COMPILED_MODULE_MAP,
  MODULE_IDS,
  MODULES,
  createDisabledModuleMap,
  createModuleMap,
  filterPermissionGroups,
  isDependencyClosed,
  validateModuleComposition,
  validateModuleComposition as validateModuleConfig,
  type ModuleId,
  type ModuleMap,
  type ModuleMeta,
} from "@/lib/module-registry"
