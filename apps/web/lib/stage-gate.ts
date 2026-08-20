/**
 * Per-stage entry requirements — the information that must be on a funnel before
 * it may advance into a given stage (mirrors the "fill in the info to mark this
 * stage" gate in Salesforce). Shared by the client (checklist + disabled button)
 * and the server (authoritative enforcement).
 *
 * Required fields are CONFIGURABLE per `pipeline_stages.requiredFields` (a list of
 * field keys). A key is either a PRESET system field (REQUIRABLE_FIELDS — backed
 * by a real funnel column) or a tenant-defined CUSTOM field (key from
 * tenant_settings.customFunnelFields; value stored in funnels.customFields).
 * `buildStageGate` resolves both into { satisfied, labels } so the gate logic
 * doesn't care which kind a key is.
 */

import { PERMISSIONS } from "@/lib/permissions"
import type { PpvvcPatch } from "@/lib/ppvvc"

/** Completeness of the preset system fields (derived from real funnel /
 *  opportunity-container columns — see {@link REQUIRABLE_FIELDS} for which). */
export type StageGateState = {
  hasEstimate: boolean
  hasCloseDate: boolean
  hasContact: boolean
  hasNature: boolean
  hasQuote: boolean
  // Salesforce parity fields — read from the parent Opportunity CONTAINER
  // (not the funnel's cascaded copy), per the validation-rule formulas.
  hasVision: boolean
  hasPain: boolean
  hasOwnerContact: boolean
  hasOwnerBudgetLimit: boolean
  hasOppEstimatedBudget: boolean
  hasOppEstimatedCloseDate: boolean
  hasValue: boolean
  hasPowerSponsorContact: boolean
  hasPowerSponsorBudgetLimit: boolean
  hasControl: boolean
  // 4A fields — read from the funnel itself.
  hasProcurementStage: boolean
  hasNegotiationDone: boolean
  hasNegotiationDate: boolean
  hasExpectedInvoice: boolean
  hasProjectYear: boolean
  hasAwardDate: boolean
  hasPurchaseOrderNumber: boolean
  hasContract: boolean
}

/** Recompute PPVVC-backed gate flags after an inline authoritative save. */
export function applyPpvvcToStageGate(
  gate: StageGate,
  values: PpvvcPatch | null | undefined
): StageGate {
  const present = (value: string | null | undefined) =>
    typeof value === "string" && value.trim() !== ""
  const satisfied = { ...gate.satisfied }
  if (values && Object.prototype.hasOwnProperty.call(values, "pain")) {
    satisfied.objective = present(values.pain)
  }
  if (values && Object.prototype.hasOwnProperty.call(values, "power")) {
    const ok = present(values.power)
    satisfied.powerSponsorContact = ok
    satisfied.powerSponsorBudgetLimit = ok
  }
  if (values && Object.prototype.hasOwnProperty.call(values, "vision")) {
    satisfied.vision = present(values.vision)
  }
  if (values && Object.prototype.hasOwnProperty.call(values, "value")) {
    satisfied.value = present(values.value)
  }
  if (values && Object.prototype.hasOwnProperty.call(values, "control")) {
    satisfied.control = present(values.control)
  }
  return {
    satisfied,
    labels: gate.labels,
  }
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

/** The preset fields an admin can require (each backed by a real column on
 *  the funnel or its parent Opportunity container). */
export type PresetFieldKey =
  | "estimate"
  | "closeDate"
  | "contact"
  | "nature"
  | "quote"
  | "vision"
  | "objective"
  | "ownerContact"
  | "ownerBudgetLimit"
  | "oppEstimatedBudget"
  | "oppEstimatedCloseDate"
  | "value"
  | "powerSponsorContact"
  | "powerSponsorBudgetLimit"
  | "control"
  | "procurementStage"
  | "negotiationDone"
  | "negotiationDate"
  | "expectedInvoice"
  | "projectYear"
  | "awardDate"
  | "purchaseOrderNumber"
  | "contract"

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
  vision: { stateKey: "hasVision", label: "Vision" },
  objective: { stateKey: "hasPain", label: "Pain (Objective)" },
  ownerContact: { stateKey: "hasOwnerContact", label: "Opportunity Owner Contact" },
  ownerBudgetLimit: {
    stateKey: "hasOwnerBudgetLimit",
    label: "Opportunity Owner Budget Limit",
  },
  oppEstimatedBudget: { stateKey: "hasOppEstimatedBudget", label: "Estimated Budget" },
  oppEstimatedCloseDate: {
    stateKey: "hasOppEstimatedCloseDate",
    label: "Estimated Close Date",
  },
  value: { stateKey: "hasValue", label: "Value" },
  powerSponsorContact: {
    stateKey: "hasPowerSponsorContact",
    label: "Power Sponsor Contact",
  },
  powerSponsorBudgetLimit: {
    stateKey: "hasPowerSponsorBudgetLimit",
    label: "Power Sponsor Budget Limit",
  },
  control: { stateKey: "hasControl", label: "Control" },
  procurementStage: { stateKey: "hasProcurementStage", label: "Procurement Process Stage" },
  negotiationDone: { stateKey: "hasNegotiationDone", label: "Negotiation Done?" },
  negotiationDate: { stateKey: "hasNegotiationDate", label: "Negotiation Date" },
  expectedInvoice: {
    stateKey: "hasExpectedInvoice",
    label: "Expected Invoice Month/Year",
  },
  projectYear: { stateKey: "hasProjectYear", label: "Project / License Year" },
  awardDate: { stateKey: "hasAwardDate", label: "Award Date" },
  purchaseOrderNumber: {
    stateKey: "hasPurchaseOrderNumber",
    label: "Purchase Order Number",
  },
  contract: { stateKey: "hasContract", label: "Contract" },
}

export const REQUIRABLE_FIELD_KEYS = Object.keys(
  REQUIRABLE_FIELDS
) as PresetFieldKey[]

/**
 * Preset keys tied to Opportunity-level PPVVC analysis fields. These can be
 * skipped for direct Won transitions to preserve the Salesforce behavior noted
 * by the team (quick Won closure from early stages without full PPVVC blocks).
 */
export const PPVVC_PRESET_KEYS: PresetFieldKey[] = [
  "vision",
  "objective",
  "powerSponsorContact",
  "powerSponsorBudgetLimit",
  "value",
]

const PPVVC_PRESET_KEY_SET = new Set(PPVVC_PRESET_KEYS)

type RequiredKeysOptions = {
  skipPpvvcForWonTransition?: boolean
}

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
  const satisfied: Record<string, boolean> = {}
  const labels: Record<string, string> = {}
  for (const k of REQUIRABLE_FIELD_KEYS) {
    satisfied[k] = !!presets[REQUIRABLE_FIELDS[k].stateKey]
    labels[k] = REQUIRABLE_FIELDS[k].label
  }
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
  if (transitionDirection(from, to) === "rollback") return []
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

/** Fields that must already be complete before entering a forward stage. */
export function stagesRequiredBefore<
  T extends { id: string; kind: string; sortOrder: number }
>(stages: T[], currentStageId: string, targetStageId: string): T[] {
  const from = stages.find((s) => s.id === currentStageId)
  const to = stages.find((s) => s.id === targetStageId)
  if (!from || !to || transitionDirection(from, to) !== "forward") return []
  if (to.kind === "LOST" || to.kind === "PARKED") return []
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter(
      (s) =>
        (s.kind === "OPEN" || s.kind === "WON") &&
        s.sortOrder < to.sortOrder
    )
}

/** Union (order-preserving, de-duplicated) of requiredFields across stages. */
export function requiredKeysForStages<
  T extends { requiredFields?: string[] | null }
>(stages: T[], options: RequiredKeysOptions = {}): string[] {
  const seen = new Set<string>()
  const skipPpvvc = options.skipPpvvcForWonTransition
  const out: string[] = []
  for (const s of stages)
    for (const k of s.requiredFields ?? []) {
      if (skipPpvvc && isPresetFieldKey(k) && PPVVC_PRESET_KEY_SET.has(k))
        continue
      if (!seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    }
  // A direct Won shortcut may omit PPVVC analysis, but it must still identify
  // the opportunity owner even when that requirement belongs to the stage
  // being left rather than one of the entered stages.
  if (skipPpvvc && !seen.has("ownerContact")) out.push("ownerContact")
  return out
}

/** Closed Won and Closed Lost are immutable terminal stages. */
export function isTerminalKind(kind: string): boolean {
  return kind === "WON" || kind === "LOST"
}

export type TransitionStage = {
  id: string
  kind: string
  sortOrder: number
  requiresApprovalToEnter?: boolean
}

export type TransitionDirection = "forward" | "rollback"

/**
 * The single stage-transition policy shared by the server and client:
 * - no-op moves are rejected;
 * - Closed Won and Closed Lost are immutable;
 * - OPEN and PARKED stages may move to any other stage, including backward.
 */
export function canTransition(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  if (from.id === to.id) return false
  return from.kind !== "WON" && from.kind !== "LOST"
}

/**
 * Classify a legal stage move using status semantics before ladder order:
 * entering PARKED is a forward close/KIV move, while PARKED→OPEN is a
 * reversible reopen. Terminal destinations are also forward even when their
 * tenant-configured sort order is unusual.
 */
export function transitionDirection(
  from: TransitionStage,
  to: TransitionStage
): TransitionDirection | null {
  if (!canTransition(from, to)) return null
  if (from.kind === "PARKED" && to.kind === "OPEN") return "rollback"
  if (to.kind === "PARKED" || isTerminalKind(to.kind)) return "forward"
  return to.sortOrder < from.sortOrder ? "rollback" : "forward"
}

/** A move that intentionally skips all stage-entry gates and approvals. */
export function isRollbackTransition(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  return transitionDirection(from, to) === "rollback"
}

/**
 * Enforce the stage state machine for a single move:
 *  - the deal can't move to the stage it's already in,
 *  - Closed Won and Closed Lost deals can't move at all,
 *  - OPEN and PARKED stages may move backward or forward.
 */
export function assertTransitionAllowed(
  from: TransitionStage,
  to: TransitionStage
): void {
  if (from.id === to.id) throw new Error("This funnel is already in this stage")
  if (isTerminalKind(from.kind))
    throw new Error("This funnel is closed and cannot change its stage.")
}

/** Whether the actor may enter approval-gated stages without a request:
 *  superadmin, or a holder of the stage-approval permission. */
export function canBypassApproval(ctx: {
  isSuperadmin: boolean
  can: (key: string) => boolean
}): boolean {
  return ctx.isSuperadmin || ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE)
}

/** Terminal stages (Lost / KIV) need a written close reason ("close remarks"). */
export function requiresCloseRemarks(kind: string): boolean {
  return kind === "LOST" || kind === "PARKED"
}

/** Approval policy for a legal transition. KIV reopens require approval even
 * though they are rollback moves; all forward stages use their stage setting. */
export function requiresApprovalForTransition(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  const direction = transitionDirection(from, to)
  if (!direction) return false
  if (direction === "rollback") return from.kind === "PARKED"
  return !!to.requiresApprovalToEnter
}

/** Lost deals require a reason when reopened; terminal close moves retain
 * their existing close-remarks requirement. */
export function requiresTransitionReason(
  from: TransitionStage,
  to: TransitionStage
): boolean {
  return requiresCloseRemarks(to.kind) || from.kind === "LOST"
}

/** Friendly label for the close-remarks field, by terminal kind. */
export function closeRemarksLabel(kind: string): string {
  if (kind === "LOST") return "Lost reason (close remarks)"
  if (kind === "PARKED") return "KIV reason (close remarks)"
  return "Reason"
}

/**
 * Stage entry triggers the Salesforce "Create New Project Item List Records
 * in Renewal, 4A and Closed Won" flow (payment-milestone auto-create).
 * Applies identically to renewal and non-renewal funnels — there is no
 * separate "Renewal" pipeline stage to special-case here, so entering 4A or
 * Won is the whole trigger. The caller is still responsible for only
 * inserting when the funnel doesn't already have milestones.
 */
export function entersMilestoneAutoCreateStage(stage: {
  code: string
  kind: string
}): boolean {
  return stage.code === "4a" || stage.kind === "WON"
}
