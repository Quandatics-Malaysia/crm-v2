/** Canonical stage codes/kinds. Kept out of the "use server" actions file
 *  (which may only export async functions). */
export const STAGE_CODES = [
  "0e",
  "1d",
  "2c",
  "3b",
  "4a",
  "won",
  "lost",
  "kiv",
] as const
export type StageCode = (typeof STAGE_CODES)[number]

export const STAGE_KINDS = ["OPEN", "WON", "LOST", "PARKED"] as const
export type StageKind = (typeof STAGE_KINDS)[number]

/** Human-readable label for each raw stage code, e.g. "2c → Proposal (2c)". */
export const STAGE_CODE_LABELS: Record<StageCode, string> = {
  "0e": "Identified (0e)",
  "1d": "Qualified (1d)",
  "2c": "Proposal (2c)",
  "3b": "Negotiation (3b)",
  "4a": "Commit (4a)",
  won: "Closed Won (won)",
  lost: "Closed Lost (lost)",
  kiv: "Keep In View (kiv)",
}

/** Friendly label for each stage Kind. */
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  OPEN: "Open — active pipeline",
  WON: "Won — closed successfully",
  LOST: "Lost — closed, not pursued",
  PARKED: "Parked / on-hold (KIV)",
}

/**
 * What Kind controls: it is the locked semantic class that drives pipeline and
 * forecast logic — only OPEN/WON deals count toward the forecast, and WON/LOST
 * are terminal closes. Pick it to match the Code; it can't be changed later.
 */
export const STAGE_KIND_DESCRIPTION =
  "Kind sets the deal's lifecycle class and is locked after creation. OPEN = active pipeline, WON = closed-won, LOST = closed-lost, PARKED = on-hold (KIV). Only OPEN and WON stages feed the billing forecast."

/** Suggested Kind for a given Code (used to auto-fill on Code change). */
export function suggestKindForCode(code: StageCode): StageKind {
  if (code === "won") return "WON"
  if (code === "lost") return "LOST"
  if (code === "kiv") return "PARKED"
  return "OPEN"
}

/** Whether a Kind should be counted in the forecast by default. */
export function defaultIncludeInForecast(kind: StageKind): boolean {
  return kind === "OPEN" || kind === "WON"
}
