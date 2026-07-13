import "server-only"
import type { FieldRegistry, RegistryKey } from "./types"

// Stub — the next task fills in per-entity field sets + FK loaders.
export const CHANGE_FIELDS: Record<RegistryKey, FieldRegistry> = {
  account: {},
  person: {},
  lead: {},
  opportunity: {},
  funnel: {},
  project: {},
  finance_doc: {},
}
