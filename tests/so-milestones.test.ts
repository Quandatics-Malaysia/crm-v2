import { describe, expect, it } from "vitest"
import { deriveSoMilestones } from "@/lib/so-milestones"

const sum = (rows: { amount: string }[]) =>
  rows.reduce((n, r) => n + Number(r.amount), 0)

describe("deriveSoMilestones", () => {
  it("groups lines by product category with proportional amounts", () => {
    const rows = deriveSoMilestones(
      10000,
      [
        { projectNatureCode: "LIC", lineSubtotal: "6000.00" },
        { projectNatureCode: "PS", lineSubtotal: "3000.00" },
        { projectNatureCode: "LIC", lineSubtotal: "1000.00" }, // merges into LIC
      ],
      { LIC: "License", PS: "Professional Services" }
    )
    expect(rows).toEqual([
      {
        title: "License",
        amount: "7000.00",
        splitPercentage: "70.00",
        productCategory: "LIC",
        sortOrder: 0,
      },
      {
        title: "Professional Services",
        amount: "3000.00",
        splitPercentage: "30.00",
        productCategory: "PS",
        sortOrder: 1,
      },
    ])
  })

  it("reconciles to the net value to the cent (last group absorbs rounding)", () => {
    const rows = deriveSoMilestones(100.01, [
      { projectNatureCode: "A", lineSubtotal: "33.33" },
      { projectNatureCode: "B", lineSubtotal: "33.33" },
      { projectNatureCode: "C", lineSubtotal: "33.34" },
    ])
    expect(sum(rows)).toBeCloseTo(100.01, 10)
    for (const r of rows) expect(r.amount).toMatch(/^\d+\.\d{2}$/)
  })

  it("falls back to one Full Payment milestone when no line is categorised", () => {
    const rows = deriveSoMilestones(5000, [
      { projectNatureCode: null, lineSubtotal: "5000.00" },
    ])
    expect(rows).toEqual([
      {
        title: "Full Payment",
        amount: "5000.00",
        splitPercentage: "100.00",
        productCategory: null,
        sortOrder: 0,
      },
    ])
    // Same fallback when there are no lines at all.
    expect(deriveSoMilestones(5000, [])).toEqual(rows)
  })

  it("labels an untagged group among tagged ones as Other, keeping the code as title when unnamed", () => {
    const rows = deriveSoMilestones(1000, [
      { projectNatureCode: "AMS", lineSubtotal: "750.00" },
      { projectNatureCode: null, lineSubtotal: "250.00" },
    ])
    expect(rows.map((r) => r.title)).toEqual(["AMS", "Other"])
    expect(rows.map((r) => r.amount)).toEqual(["750.00", "250.00"])
  })

  it("returns [] for zero, negative, or invalid net values", () => {
    const lines = [{ projectNatureCode: "LIC", lineSubtotal: "100.00" }]
    expect(deriveSoMilestones(0, lines)).toEqual([])
    expect(deriveSoMilestones(-1, lines)).toEqual([])
    expect(deriveSoMilestones(NaN, lines)).toEqual([])
  })
})
