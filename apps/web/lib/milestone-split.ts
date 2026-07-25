/**
 * Pure payment-milestone split: allocate a project value across a tenant
 * template of {title, percent} rows.
 *
 * Invariants:
 * - Every amount is a whole-cent string ("1234.50").
 * - No allocation ever exceeds the remaining value (clamped per row).
 * - When the template allocates exactly 100%, the LAST row absorbs cent
 *   rounding so Σ amounts === value to the cent.
 * - A partial template (< 100%) allocates only its share; the remainder is
 *   deliberately left unallocated for manual milestones.
 */
export type MilestoneTemplateEntry = { title: string; percent: number }

export type MilestoneSplit = {
  title: string
  amount: string
  sortOrder: number
}

export function splitMilestones(
  value: number,
  template: MilestoneTemplateEntry[]
): MilestoneSplit[] {
  if (!Number.isFinite(value) || value <= 0 || template.length === 0) return []

  const centsValue = Math.round(value * 100)
  const totalPercent = template.reduce((n, t) => n + t.percent, 0)
  const fullyAllocated = Math.abs(totalPercent - 100) < 0.0001

  let used = 0
  return template.map((t, i) => {
    let cents =
      i === template.length - 1 && fullyAllocated
        ? centsValue - used
        : Math.round((centsValue * t.percent) / 100)
    cents = Math.max(0, Math.min(cents, centsValue - used))
    used += cents
    return {
      title: t.title,
      amount: (cents / 100).toFixed(2),
      sortOrder: i,
    }
  })
}
