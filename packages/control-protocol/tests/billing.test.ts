import { describe, expect, it } from "vitest"

import {
  addCalendarMonths,
  buildCollectionMilestones,
  calculateContractTotal,
  countMonthlyBillingPeriods,
  getMonthlyBillingPeriods,
} from "@crm/control-protocol/billing"

describe("shared billing", () => {
  it("preserves anchored monthly periods and final-cycle proration", () => {
    const periods = getMonthlyBillingPeriods("2026-08-05", "2026-09-19")

    expect(periods).toHaveLength(2)
    expect(periods[0]).toEqual({ startsAt: "2026-08-05", endsAt: "2026-09-04", factor: 1 })
    expect(periods[1].factor).toBeCloseTo(15 / 30)
    expect(countMonthlyBillingPeriods("2026-08-05", "2027-08-04")).toBe(12)
    expect(addCalendarMonths("2027-01-31", 1)).toBe("2027-02-28")
  })

  it("preserves valid-input total and final-cent allocation semantics", () => {
    expect(calculateContractTotal(250, 2, 1.5, 6)).toEqual({
      subtotal: 750,
      taxAmount: 45,
      total: 795,
    })

    const milestones = buildCollectionMilestones({
      frequency: "monthly",
      billingPeriods: 3,
      firstDueAt: "2026-08-31",
      total: 1,
      weights: [1, 1, 1],
    })

    expect(milestones.map(({ dueAt, amount }) => ({ dueAt, amount }))).toEqual([
      { dueAt: "2026-08-31", amount: 0.33 },
      { dueAt: "2026-09-30", amount: 0.33 },
      { dueAt: "2026-10-31", amount: 0.34 },
    ])
  })
})
