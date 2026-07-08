/**
 * Plugin registry — the generalized, config-driven module system.
 *
 * A plugin is live for the whole deployment when its flag in
 * `modules.config.ts` is `true`. This registry is the SOLE gate: the older
 * per-tenant `tenant_settings.finance_module` / `documentation_module` columns
 * are retained in the schema but no longer consulted for gating.
 *
 * Pure constants + pure functions — NO `server-only`, NO `db` import — so this
 * is safe to import from client and server code alike (nav, permission
 * catalog, next-free services, and the DB seed scripts all import it).
 */
import { MODULE_CONFIG } from "@/modules.config"

export type ModuleId = keyof typeof MODULE_CONFIG

export type ModuleMeta = {
  id: ModuleId
  /** Human label, e.g. used in "The X module is disabled." messages. */
  label: string
  /** Other modules that must also be enabled for this one to be valid. */
  dependsOn: ModuleId[]
}

/**
 * Metadata + dependency graph. Kept in code (not config) so dependencies are
 * an invariant of the platform, not something an operator can misconfigure.
 * `finance` roots its document chain on an approved sales order that hangs off
 * a project, so it requires both `salesOrders` and `projects`.
 */
export const MODULES: Record<ModuleId, ModuleMeta> = {
  projects: { id: "projects", label: "Projects", dependsOn: [] },
  salesOrders: { id: "salesOrders", label: "Sales Orders", dependsOn: ["projects"] },
  finance: { id: "finance", label: "Billing & Purchasing", dependsOn: ["projects", "salesOrders"] },
  forecast: { id: "forecast", label: "Forecast", dependsOn: [] },
  audit: { id: "audit", label: "Audit log", dependsOn: [] },
  advancedRoles: { id: "advancedRoles", label: "Advanced roles", dependsOn: [] },
  documentation: { id: "documentation", label: "Documentation", dependsOn: [] },
}

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[]

/** Sole source of truth for whether a plugin is live. Pure & synchronous. */
export function isModuleEnabled(id: ModuleId): boolean {
  return MODULE_CONFIG[id] === true
}

/**
 * Guard for server actions / services. Throws a user-facing error when the
 * plugin is disabled — defense in depth behind the hidden nav and route
 * redirects.
 */
export function assertModuleEnabled(id: ModuleId): void {
  if (!isModuleEnabled(id)) {
    throw new Error(`The ${MODULES[id].label} module is disabled.`)
  }
}

/**
 * Boot-time invariant: every enabled module's dependencies must also be
 * enabled. Returns a list of human-readable errors (empty when the config is
 * valid). Called from instrumentation.ts.
 */
export function validateModuleConfig(): string[] {
  const errors: string[] = []
  for (const id of MODULE_IDS) {
    if (!isModuleEnabled(id)) continue
    for (const dep of MODULES[id].dependsOn) {
      if (!isModuleEnabled(dep)) {
        errors.push(
          `Module "${id}" is enabled but its dependency "${dep}" is off. ` +
            `Enable "${dep}" in modules.config.ts or disable "${id}".`
        )
      }
    }
  }
  return errors
}

/**
 * Back-compat alias for the ~13 sites that still import the old code-level
 * kill switch. Now a thin view over the registry.
 * @deprecated prefer `isModuleEnabled("finance")`.
 */
export const FINANCE_MODULE = isModuleEnabled("finance")
