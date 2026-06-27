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
  OPEN: "Open — active funnel",
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
  "Kind sets the funnel's lifecycle class and is locked after creation. OPEN = active funnel, WON = closed-won, LOST = closed-lost, PARKED = on-hold (KIV). Only OPEN and WON stages feed the billing forecast."

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

// ─── Product types ─────────────────────────────────────────────────────────

/**
 * A tenant-managed product type: a short stable CODE used as the PRODUCTTYPE
 * segment of a project code ({YYYY}-{Entity}-{Account}-{ProductType}-{NNN}),
 * plus a human-readable display NAME.
 */
export type ProductType = { code: string; name: string }

/** Max length for a product-type code (keeps project codes short). */
export const PRODUCT_TYPE_CODE_MAX = 8

/** Trim + uppercase a product-type code for storage/comparison. */
export function normalizeProductTypeCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

/**
 * Validate a normalized product-type code. Returns an error message, or null
 * when valid. A valid code is non-empty, at most PRODUCT_TYPE_CODE_MAX chars,
 * and made of uppercase letters and digits only (so it is safe in a code).
 */
export function validateProductTypeCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PRODUCT_TYPE_CODE_MAX) {
    return `Code must be ${PRODUCT_TYPE_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    return "Code must be uppercase letters and digits only."
  }
  return null
}
