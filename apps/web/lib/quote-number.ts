/**
 * Pure helpers for the Salesforce-format quotation reference. No IO, no
 * `server-only`, so they are unit-testable and safe to import anywhere.
 *
 * Client's Salesforce behavior being mirrored:
 *  - The running number is per-FUNNEL: every quote in a funnel shares ONE
 *    running number, assigned on the funnel's FIRST quote (global max + 1).
 *  - The revision is per-quote-in-funnel: `quotations.version`, 1 for the
 *    first quote, max(version) + 1 thereafter.
 *  - The FORMAT depends on the funnel's EARLIEST quote's creation date:
 *      before 1 Sept 2025 → old format `Q{yy}-{running}-{rev}`
 *      on/after 1 Sept 2025 → new format `Q1{running}-{rev}`
 *    A brand-new funnel (no earlier quote) always gets the new format, since
 *    it is created "now" — always after the cutoff.
 */

/** Default zero-pad width for the running number, overridable per tenant. */
export const QUOTE_PAD_WIDTH = 4

/**
 * The format switch date: funnels whose earliest quote predates this get the
 * legacy Salesforce-era `Q{yy}-...` numbering; on/after this, the new
 * `Q1...` numbering applies. Compared as an instant (UTC midnight) so the
 * comparison is unambiguous regardless of caller/server timezone.
 */
export const QUOTE_FORMAT_CUTOFF = new Date("2025-09-01T00:00:00.000Z")

/**
 * Format the Salesforce-style quote reference for a given running number +
 * revision, choosing old vs. new format from the funnel's earliest quote
 * date (or the new format when there is none yet, i.e. this call IS the
 * funnel's first quote).
 */
export function formatQuoteRef({
  running,
  rev,
  earliestQuoteDate,
  pad = QUOTE_PAD_WIDTH,
}: {
  /** The funnel's shared running number (assigned once per funnel). */
  running: number
  /** This quote's revision within the funnel (quotations.version). */
  rev: number
  /**
   * The funnel's earliest quote's creation timestamp, or `null` when this
   * call is minting the funnel's first quote (no earlier quote exists yet).
   */
  earliestQuoteDate: Date | string | null
  /** Zero-pad width for the running number (tenant-configurable). */
  pad?: number
}): string {
  const runningStr = String(Math.trunc(running)).padStart(pad, "0")
  const revStr = String(Math.trunc(rev))
  const earliest = typeof earliestQuoteDate === "string"
    ? new Date(earliestQuoteDate)
    : earliestQuoteDate

  if (earliest !== null && Number.isNaN(earliest.getTime())) {
    throw new TypeError("Invalid earliest quotation date")
  }

  if (earliest !== null && earliest.getTime() < QUOTE_FORMAT_CUTOFF.getTime()) {
    const yy = earliest.toISOString().slice(2, 4)
    return `Q${yy}-${runningStr}-${revStr}`
  }
  return `Q1${runningStr}-${revStr}`
}
