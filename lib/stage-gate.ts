/**
 * Per-stage entry requirements — the information that must be on a funnel before
 * it may advance into a given stage (mirrors the "fill in the info to mark this
 * stage" gate in Salesforce). Shared by the client (checklist + disabled button)
 * and the server (authoritative enforcement).
 *
 * Required fields are CONFIGURABLE per `funnel_stages.requiredFields` (a list of
 * field keys). A key is either a PRESET system field (REQUIRABLE_FIELDS — backed
 * by a real funnel column) or a tenant-defined CUSTOM field (key from
 * tenant_settings.customFunnelFields; value stored in opportunities.customFields).
 * `buildStageGate` resolves both into { satisfied, labels } so the gate logic
 * doesn't care which kind a key is.
 */

/** Completeness of the preset system fields (derived from real funnel columns). */
export type StageGateState = {
  hasEstimate: boolean
  hasCloseDate: boolean
  hasContact: boolean
  hasNature: boolean
  hasQuote: boolean
}

/** Input type for a tenant-defined custom funnel field. */
export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select"

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox (yes/no)" },
  { value: "select", label: "Dropdown" },
]

/** A tenant-defined custom funnel field. Legacy rows may lack `type` → "text". */
export type CustomFunnelField = {
  key: string
  label: string
  type?: CustomFieldType
  /** Choices for a `select` field. */
  options?: string[]
  /** Optional help text shown under the input on the funnel form. */
  description?: string
  /** Optional section these fields group under (e.g. "Power Sponsor"). */
  category?: string
}

/**
 * Group fields into ordered sections by `category` (uncategorized fields fall
 * under `category: null`). Order follows first appearance so the settings order
 * is preserved on the funnel.
 */
export function groupCustomFields(
  fields: CustomFunnelField[]
): { category: string | null; fields: CustomFunnelField[] }[] {
  const groups: { category: string | null; fields: CustomFunnelField[] }[] = []
  const index = new Map<string, number>()
  for (const f of fields) {
    const cat = f.category?.trim() || null
    const key = cat ?? ""
    if (!index.has(key)) {
      index.set(key, groups.length)
      groups.push({ category: cat, fields: [] })
    }
    groups[index.get(key)!].fields.push(f)
  }
  return groups
}

/** Human-readable display of a custom field's stored value, by type. */
export function formatCustomFieldValue(
  field: CustomFunnelField,
  value: unknown
): string {
  const s = value == null ? "" : String(value).trim()
  if (s === "") return "—"
  if (field.type === "checkbox") return s === "true" ? "Yes" : "No"
  return s
}

/** The preset fields an admin can require (each backed by a funnel column). */
export type PresetFieldKey =
  | "estimate"
  | "closeDate"
  | "contact"
  | "nature"
  | "quote"

/** Catalog of preset fields → (the completeness flag it reads, human label). */
export const REQUIRABLE_FIELDS: Record<
  PresetFieldKey,
  { stateKey: keyof StageGateState; label: string }
> = {
  estimate: { stateKey: "hasEstimate", label: "Estimated funnel amount" },
  closeDate: { stateKey: "hasCloseDate", label: "Expected close date" },
  contact: { stateKey: "hasContact", label: "Primary contact" },
  nature: { stateKey: "hasNature", label: "Project nature(s)" },
  quote: { stateKey: "hasQuote", label: "A quotation" },
}

export const REQUIRABLE_FIELD_KEYS = Object.keys(
  REQUIRABLE_FIELDS
) as PresetFieldKey[]

export function isPresetFieldKey(k: string): k is PresetFieldKey {
  return k in REQUIRABLE_FIELDS
}

/** Resolved gate: which requirement keys are satisfied, and each key's label. */
export type StageGate = {
  satisfied: Record<string, boolean>
  labels: Record<string, string>
}

/**
 * Resolve preset completeness + custom-field values into a flat StageGate.
 * Used identically on the server (from the opp row) and client (from props).
 */
export function buildStageGate(
  presets: StageGateState,
  customValues: Record<string, unknown> | null | undefined,
  customFields: CustomFunnelField[]
): StageGate {
  const satisfied: Record<string, boolean> = {
    estimate: presets.hasEstimate,
    closeDate: presets.hasCloseDate,
    contact: presets.hasContact,
    nature: presets.hasNature,
    quote: presets.hasQuote,
  }
  const labels: Record<string, string> = {}
  for (const k of REQUIRABLE_FIELD_KEYS) labels[k] = REQUIRABLE_FIELDS[k].label
  for (const f of customFields ?? []) {
    const v = customValues?.[f.key]
    const s = v == null ? "" : String(v).trim()
    // A required checkbox must be ticked ("true"); everything else just needs
    // a non-empty value.
    satisfied[f.key] = f.type === "checkbox" ? s === "true" : s !== ""
    labels[f.key] = f.label
  }
  return { satisfied, labels }
}

export type ResolvedReq = { key: string; label: string; ok: boolean }

/** Every requirement configured on a stage, with its satisfied flag + label. */
export function requirementsFromKeys(
  keys: string[] | null | undefined,
  gate: StageGate
): ResolvedReq[] {
  return (keys ?? []).map((k) => ({
    key: k,
    label: gate.labels[k] ?? k,
    ok: !!gate.satisfied[k],
  }))
}

/** The configured requirements not yet satisfied. */
export function missingFromKeys(
  keys: string[] | null | undefined,
  gate: StageGate
): { key: string; label: string }[] {
  return requirementsFromKeys(keys, gate)
    .filter((r) => !r.ok)
    .map(({ key, label }) => ({ key, label }))
}

/**
 * The ordered stages a move from `currentStageId` to `targetStageId` enters. A
 * forward OPEN→OPEN/WON move passes through every ladder stage after the current
 * one up to and including the target — so skipping 0e→4a still collects the
 * requirements of 1d/2c/3b. An off-ladder terminal target (LOST/PARKED) enters
 * only itself.
 */
export function stagesEnteredBy<
  T extends { id: string; kind: string; sortOrder: number }
>(stages: T[], currentStageId: string, targetStageId: string): T[] {
  const from = stages.find((s) => s.id === currentStageId)
  const to = stages.find((s) => s.id === targetStageId)
  if (!from || !to) return []
  if (to.kind === "LOST" || to.kind === "PARKED") return [to]
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter(
      (s) =>
        (s.kind === "OPEN" || s.kind === "WON") &&
        s.sortOrder > from.sortOrder &&
        s.sortOrder <= to.sortOrder
    )
}

/** Union (order-preserving, de-duplicated) of requiredFields across stages. */
export function requiredKeysForStages<
  T extends { requiredFields?: string[] | null }
>(stages: T[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of stages)
    for (const k of s.requiredFields ?? [])
      if (!seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
  return out
}

/** Terminal stages (Lost / KIV) need a written close reason ("close remarks"). */
export function requiresCloseRemarks(kind: string): boolean {
  return kind === "LOST" || kind === "PARKED"
}

/** Friendly label for the close-remarks field, by terminal kind. */
export function closeRemarksLabel(kind: string): string {
  if (kind === "LOST") return "Lost reason (close remarks)"
  if (kind === "PARKED") return "KIV reason (close remarks)"
  return "Reason"
}

