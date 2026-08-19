/**
 * Pure helpers for the Opportunity container + Funnel naming (Salesforce-aligned
 * two-level model — see https://github.com/Super-ERP/docs/blob/main/archive/specs/2026-07-07-opportunity-funnel-remodel-design.md). No IO, no `server-only`, so they are unit-testable and
 * safe to import anywhere.
 */

/** Zero-padded default for the opportunity running number. */
export const OPPORTUNITY_PAD_WIDTH = 4

/**
 * The next per-year running number given the numbers already issued for that
 * (tenant, year). Gap-tolerant: always `max + 1`, or 1 when none exist.
 */
export function nextOpportunityNumber(existingNumbersForYear: number[]): number {
  let max = 0
  for (const n of existingNumbersForYear) {
    if (Number.isFinite(n) && n > max) max = Math.trunc(n)
  }
  return max + 1
}

/**
 * Formulated Opportunity id, e.g. `QMOPP-2026-0001`. The organization code
 * is normalized to uppercase alphanumeric characters before formatting.
 */
export function formatOpportunityCode(
  input: {
    organizationCode: string
    year: number
    number: number
  }
): string {
  const organizationCode = input.organizationCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  if (!organizationCode) throw new Error("Organization code is required")

  const yyyy = String(Math.trunc(input.year))
  const running = String(Math.trunc(input.number)).padStart(
    OPPORTUNITY_PAD_WIDTH,
    "0"
  )
  return `${organizationCode}OPP-${yyyy}-${running}`
}

/**
 * The Funnel display name per the Salesforce format:
 *   `{projectYear} {companyCode} {Project|Renewal} - {products}`
 * Missing segments are omitted gracefully so the name never has dangling
 * separators (e.g. no products → `2026 QM Project`).
 */
export function formatFunnelName(input: {
  projectYear?: number | null
  companyCode?: string | null
  isRenewal?: boolean
  products?: string | null
}): string {
  const parts: string[] = []
  if (input.projectYear) parts.push(String(Math.trunc(input.projectYear)))
  const code = (input.companyCode ?? "").trim()
  if (code) parts.push(code.toUpperCase())
  parts.push(input.isRenewal ? "Renewal" : "Project")
  const head = parts.join(" ")
  const products = (input.products ?? "").trim()
  return products ? `${head} - ${products}` : head
}

export {
  PPVVC_FIELDS,
  type PpvvcField,
  type PpvvcPatch as Ppvvc,
} from "@/lib/ppvvc"
import { PPVVC_FIELDS } from "@/lib/ppvvc"
import type { PpvvcPatch } from "@/lib/ppvvc"

/** Pick just the PPVVC fields off any object (for cascading container → funnel). */
export function pickPpvvc(src: PpvvcPatch | null | undefined): PpvvcPatch {
  const out: PpvvcPatch = {}
  if (!src) return out
  for (const { key } of PPVVC_FIELDS) out[key] = src[key] ?? null
  return out
}
