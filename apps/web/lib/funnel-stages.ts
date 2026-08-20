/**
 * The canonical 8-stage funnel ladder, seeded per tenant.
 * Labels & probabilities are tenant-editable; `kind` semantics are locked and
 * drive all pipeline + forecast logic. Forward stage changes require approval.
 */
export type StageKindValue = "OPEN" | "WON" | "LOST" | "PARKED"
export type StageCodeValue =
  | "0e"
  | "1d"
  | "2c"
  | "3b"
  | "4a"
  | "won"
  | "lost"
  | "kiv"

export type CanonicalStage = {
  code: StageCodeValue
  name: string
  probability: number
  kind: StageKindValue
  sortOrder: number
  requiresApprovalToEnter: boolean
  includeInForecast: boolean
}

export const CANONICAL_STAGES: CanonicalStage[] = [
  { code: "0e", name: "0e — Identified", probability: 0, kind: "OPEN", sortOrder: 0, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "1d", name: "1d — Qualified", probability: 25, kind: "OPEN", sortOrder: 1, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "2c", name: "2c — Proposal", probability: 50, kind: "OPEN", sortOrder: 2, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "3b", name: "3b — Negotiation", probability: 75, kind: "OPEN", sortOrder: 3, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "4a", name: "4a — Commit", probability: 90, kind: "OPEN", sortOrder: 4, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "won", name: "Closed Won", probability: 100, kind: "WON", sortOrder: 5, requiresApprovalToEnter: true, includeInForecast: true },
  { code: "lost", name: "Closed Lost", probability: 0, kind: "LOST", sortOrder: 6, requiresApprovalToEnter: false, includeInForecast: false },
  { code: "kiv", name: "KIV — Keep In View", probability: 0, kind: "PARKED", sortOrder: 7, requiresApprovalToEnter: false, includeInForecast: false },
]

export const FIRST_STAGE_CODE: StageCodeValue = "0e"
