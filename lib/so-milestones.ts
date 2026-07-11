/**
 * Pure derivation of payment milestones from an approved sales order's
 * quotation line items. Grouping only — no DB, no dates, no permissions —
 * so it's unit-testable; the SO approval action owns persistence.
 *
 * Rules:
 * - Lines group by `projectNatureCode` (the per-line product category).
 * - One milestone per category, amount = the category's proportional share
 *   of the quote NET value (subtotal − discount, the reconciliation
 *   baseline), allocated in whole cents with the LAST group absorbing
 *   rounding so Σ amounts === net to the cent.
 * - splitPercentage = the category's share of the line weight, 2 dp.
 * - No categorised lines (or no usable line weights) → ONE "Full Payment"
 *   milestone for the whole net value.
 * - Non-positive/invalid net value → [] (nothing to bill).
 */

export type SoQuoteLine = {
  projectNatureCode: string | null
  /** Line net (qty × unit − line discount), used as the grouping weight. */
  lineSubtotal: string | null
}

export type SoMilestoneDraft = {
  title: string
  amount: string
  splitPercentage: string
  productCategory: string | null
  sortOrder: number
}

/** Lowercase, hyphenated, alnum-only — for the hidden internal `name` suffix. */
export function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "milestone"
  )
}

/** Hidden internal identifier: `{projectCode}-{slugified title}`. Null when
 *  there is no project code (best-effort, never blocks). */
export function milestoneName(
  projectCode: string | null,
  title: string
): string | null {
  return projectCode ? `${projectCode}-${slugify(title)}` : null
}

export function deriveSoMilestones(
  netValue: number,
  lines: SoQuoteLine[],
  /** Tenant picklist: nature code → display name, for milestone titles. */
  natureNames: Record<string, string> = {}
): SoMilestoneDraft[] {
  if (!Number.isFinite(netValue) || netValue <= 0) return []

  // Group by category in first-seen order; weight = Σ line subtotals.
  const groups = new Map<string | null, number>()
  for (const line of lines) {
    const weight = Number(line.lineSubtotal ?? 0)
    if (!Number.isFinite(weight) || weight <= 0) continue
    const code = line.projectNatureCode
    groups.set(code, (groups.get(code) ?? 0) + weight)
  }
  const totalWeight = [...groups.values()].reduce((n, w) => n + w, 0)
  const hasCategories = [...groups.keys()].some((code) => code !== null)

  if (!hasCategories || totalWeight <= 0) {
    return [
      {
        title: "Full Payment",
        amount: netValue.toFixed(2),
        splitPercentage: "100.00",
        productCategory: null,
        sortOrder: 0,
      },
    ]
  }

  const netCents = Math.round(netValue * 100)
  const entries = [...groups.entries()]
  let used = 0
  return entries.map(([code, weight], i) => {
    const cents =
      i === entries.length - 1
        ? netCents - used // last group absorbs cent rounding
        : Math.round((netCents * weight) / totalWeight)
    used += cents
    return {
      title: code ? (natureNames[code] ?? code) : "Other",
      amount: (cents / 100).toFixed(2),
      splitPercentage: ((weight / totalWeight) * 100).toFixed(2),
      productCategory: code,
      sortOrder: i,
    }
  })
}
