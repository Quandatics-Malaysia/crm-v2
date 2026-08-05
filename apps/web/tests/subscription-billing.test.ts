import { describe, expect, it } from "vitest"

import {
  buildCollectionMilestones,
  calculateContractTotal,
  countMonthlyBillingPeriods,
} from "@/lib/subscription-billing"

describe("subscription billing", () => {
  it("prices a one-year contract as twelve monthly periods", () => {
    const periods = countMonthlyBillingPeriods("2026-08-05", "2027-08-04")
    expect(periods).toBe(12)
    expect(calculateContractTotal(250, 2, periods, 0).total).toBe(6000)
  })

  it("treats a 30-day contract as one monthly period", () => {
    expect(countMonthlyBillingPeriods("2026-08-05", "2026-09-03")).toBe(1)
  })

  it("generates monthly collection milestones that reconcile exactly", () => {
    const milestones = buildCollectionMilestones({
      frequency: "monthly",
      billingPeriods: 3,
      firstDueAt: "2026-08-05",
      total: 100,
    })
    expect(milestones.map((milestone) => milestone.dueAt)).toEqual([
      "2026-08-05", "2026-09-05", "2026-10-05",
    ])
    expect(milestones.reduce((sum, milestone) => sum + milestone.amount, 0)).toBe(100)
  })

  it("generates one upfront collection for the full contract", () => {
    expect(buildCollectionMilestones({
      frequency: "upfront",
      billingPeriods: 12,
      firstDueAt: "2026-08-10",
      total: 3000,
    })).toEqual([{ sequence: 1, title: "Contract collection", dueAt: "2026-08-10", amount: 3000 }])
  })
})
