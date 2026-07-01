/** Canonical stage codes/kinds. Kept out of the "use server" actions file
 *  (which may only export async functions). */
import { ROLE_TEMPLATES } from "@/lib/permissions"

/** Assignable auto-join roles (never Owner — that's for the workspace creator).
 *  Lives here (not in the "use server" actions file, which may only export
 *  async functions) so both the server action and the client card can import it. */
export const AUTO_JOIN_ROLES = ROLE_TEMPLATES.filter(
  (r) => r.name !== "Owner"
).map((r) => r.name)

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
  ""

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

// ─── Project natures ─────────────────────────────────────────────────────────

/**
 * A tenant-managed project nature: a short stable CODE used as the PROJECTNATURE
 * segment of a project code ({YYYY}-{Entity}-{Account}-{ProjectNature}-{NNN}),
 * plus a human-readable display NAME.
 */
export type ProjectNature = { code: string; name: string }

/** Max length for a project-nature code (keeps project codes short). */
export const PROJECT_NATURE_CODE_MAX = 8

/** Trim + uppercase a project-nature code for storage/comparison. */
export function normalizeProjectNatureCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

/**
 * Validate a normalized project-nature code. Returns an error message, or null
 * when valid. A valid code is non-empty, at most PROJECT_NATURE_CODE_MAX chars,
 * and made of uppercase letters and digits only (so it is safe in a code).
 */
export function validateProjectNatureCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PROJECT_NATURE_CODE_MAX) {
    return `Code must be ${PROJECT_NATURE_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    return "Code must be uppercase letters and digits only."
  }
  return null
}

// ─── Product codes ───────────────────────────────────────────────────────────

/**
 * A tenant-managed product code: a short stable CODE identifying a product line,
 * plus a human-readable display NAME. Standardised products reference one of
 * these; distinct from a project nature (which drives project codes).
 */
export type ProductCode = { code: string; name: string }

/** Max length for a product code. */
export const PRODUCT_CODE_MAX = 16

/** Trim + uppercase a product code for storage/comparison. */
export function normalizeProductCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

/**
 * Validate a normalized product code. Returns an error message, or null when
 * valid. A valid code is non-empty, at most PRODUCT_CODE_MAX chars, and made of
 * uppercase letters, digits, hyphen or underscore.
 */
export function validateProductCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PRODUCT_CODE_MAX) {
    return `Code must be ${PRODUCT_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return "Code must be uppercase letters, digits, hyphen or underscore."
  }
  return null
}
