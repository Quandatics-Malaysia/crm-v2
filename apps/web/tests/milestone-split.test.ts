import { describe, expect, it } from "vitest"
import { splitMilestones } from "@/lib/milestone-split"

const sum = (rows: { amount: string }[]) =>
  rows.reduce((n, r) => n + Number(r.amount), 0)

describe("splitMilestones", () => {
  it("splits a clean 50/40/10 exactly", () => {
    const rows = splitMilestones(10000, [
      { title: "Advance", percent: 50 },
      { title: "Delivery", percent: 40 },
      { title: "Acceptance", percent: 10 },
    ])
    expect(rows.map((r) => r.amount)).toEqual(["5000.00", "4000.00", "1000.00"])
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it("absorbs cent rounding on the last row at 100% allocation", () => {
    // 100.01 across 3 × 33.333…% would drift by a cent without absorption.
    const rows = splitMilestones(100.01, [
      { title: "A", percent: 33.33 },
      { title: "B", percent: 33.33 },
      { title: "C", percent: 33.34 },
    ])
    expect(sum(rows)).toBeCloseTo(100.01, 10)
    // Every amount is a whole-cent string.
    for (const r of rows) expect(r.amount).toMatch(/^\d+\.\d{2}$/)
  })

  it("reconciles to the cent for awkward values", () => {
    for (const value of [0.01, 0.03, 999999.99, 1234.56, 10.0]) {
      const rows = splitMilestones(value, [
        { title: "A", percent: 30 },
        { title: "B", percent: 30 },
        { title: "C", percent: 40 },
      ])
      expect(sum(rows)).toBeCloseTo(value, 10)
    }
  })

  it("leaves the remainder unallocated for a partial template", () => {
    const rows = splitMilestones(1000, [{ title: "Deposit", percent: 30 }])
    expect(rows).toEqual([{ title: "Deposit", amount: "300.00", sortOrder: 0 }])
  })

  it("never over-allocates even with drifting percents", () => {
    const rows = splitMilestones(0.05, [
      { title: "A", percent: 60 },
      { title: "B", percent: 60 }, // invalid template (>100) — still clamped
    ])
    expect(sum(rows)).toBeLessThanOrEqual(0.05)
  })

  it("returns [] for zero/negative/invalid values or an empty template", () => {
    expect(splitMilestones(0, [{ title: "A", percent: 100 }])).toEqual([])
    expect(splitMilestones(-5, [{ title: "A", percent: 100 }])).toEqual([])
    expect(splitMilestones(NaN, [{ title: "A", percent: 100 }])).toEqual([])
    expect(splitMilestones(100, [])).toEqual([])
  })
})
