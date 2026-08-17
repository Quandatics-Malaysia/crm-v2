import { describe, expect, it } from "vitest"

import {
  matchesFilter,
  parseDataTableFilterParam,
  validateFilterValue,
} from "@/lib/data-table-filters"

describe("typed data table filters", () => {
  it("matches text by contains, equals, and starts-with", () => {
    expect(
      matchesFilter("Alpha Beta", {
        type: "text",
        operator: "contains",
        value: "beta",
      })
    ).toBe(true)
    expect(
      matchesFilter("Alpha Beta", {
        type: "text",
        operator: "equals",
        value: "alpha beta",
      })
    ).toBe(true)
    expect(
      matchesFilter("Alpha Beta", {
        type: "text",
        operator: "starts-with",
        value: "alpha",
      })
    ).toBe(true)
    expect(
      matchesFilter("Alpha Beta", {
        type: "text",
        operator: "equals",
        value: "gamma",
      })
    ).toBe(false)
  })

  it("matches numeric equals, greater-than, less-than, and between", () => {
    expect(matchesFilter(15, { type: "number", operator: "equals", value: 15 })).toBe(true)
    expect(
      matchesFilter(15, { type: "number", operator: "greater-than", value: 10 })
    ).toBe(true)
    expect(
      matchesFilter(15, { type: "number", operator: "less-than", value: 20 })
    ).toBe(true)
    expect(
      matchesFilter(15, { type: "number", operator: "between", min: 10, max: 20 })
    ).toBe(true)
    expect(
      matchesFilter(25, { type: "number", operator: "between", min: 10, max: 20 })
    ).toBe(false)
  })

  it("matches money with the numeric operators", () => {
    expect(
      matchesFilter("125.50", { type: "money", operator: "equals", value: 125.5 })
    ).toBe(true)
    expect(
      matchesFilter(125, { type: "money", operator: "greater-than", value: 100 })
    ).toBe(true)
    expect(
      matchesFilter(125, { type: "money", operator: "less-than", value: 200 })
    ).toBe(true)
  })

  it("matches dates on, before, after, and between as calendar dates", () => {
    expect(
      matchesFilter("2026-08-17", { type: "date", operator: "on", value: "2026-08-17" })
    ).toBe(true)
    expect(
      matchesFilter("2026-08-10", {
        type: "date",
        operator: "before",
        value: "2026-08-17",
      })
    ).toBe(true)
    expect(
      matchesFilter("2026-08-20", {
        type: "date",
        operator: "after",
        value: "2026-08-17",
      })
    ).toBe(true)
    expect(
      matchesFilter("2026-08-15", {
        type: "date",
        operator: "between",
        from: "2026-08-10",
        to: "2026-08-20",
      })
    ).toBe(true)
  })

  it("matches boolean values", () => {
    expect(matchesFilter(true, { type: "boolean", value: true })).toBe(true)
    expect(matchesFilter(false, { type: "boolean", value: true })).toBe(false)
  })

  it("matches any selected enum value", () => {
    expect(
      matchesFilter("qualified", {
        type: "enum",
        value: ["new", "qualified"],
      })
    ).toBe(true)
    expect(matchesFilter("lost", { type: "enum", value: ["new", "qualified"] })).toBe(false)
  })

  it("matches a relation by record ID", () => {
    expect(matchesFilter("account-42", { type: "relation", value: "account-42" })).toBe(true)
    expect(matchesFilter("account-7", { type: "relation", value: "account-42" })).toBe(false)
  })

  it("treats empty values as inactive", () => {
    expect(matchesFilter("anything", { type: "text", operator: "contains", value: "" })).toBe(true)
    expect(matchesFilter(15, { type: "number", operator: "equals", value: null })).toBe(true)
    expect(matchesFilter("2026-08-17", { type: "enum", value: [] })).toBe(true)
  })

  it("rejects inverted ranges", () => {
    expect(
      validateFilterValue({
        type: "date",
        operator: "between",
        from: "2026-08-20",
        to: "2026-08-10",
      }).success
    ).toBe(false)
    expect(
      validateFilterValue({ type: "number", operator: "between", min: 20, max: 10 }).success
    ).toBe(false)
  })

  it("rejects invalid dates and non-finite numbers", () => {
    expect(validateFilterValue({ type: "date", operator: "on", value: "2026-02-30" }).success).toBe(
      false
    )
    expect(validateFilterValue({ type: "number", operator: "equals", value: NaN }).success).toBe(
      false
    )
    expect(
      validateFilterValue({ type: "money", operator: "equals", value: Number.POSITIVE_INFINITY }).success
    ).toBe(false)
  })

  it("translates legacy comma-separated enum and relation URL values", () => {
    expect(parseDataTableFilterParam("active,won", "enum")).toEqual({
      type: "enum",
      value: ["active", "won"],
    })
    expect(parseDataTableFilterParam("account-42,account-7", "relation")).toEqual({
      type: "relation",
      value: ["account-42", "account-7"],
    })
  })

  it("matches Date and ISO timestamp row values by calendar date", () => {
    const filter = { type: "date", operator: "on", value: "2026-08-17" } as const
    expect(matchesFilter(new Date("2026-08-17T12:30:00.000Z"), filter)).toBe(true)
    expect(matchesFilter("2026-08-17T23:59:59.000Z", filter)).toBe(true)
  })

  it("treats incomplete numeric and date ranges as inactive", () => {
    const numberFilter = { type: "number", operator: "between", min: 10 } as const
    const dateFilter = { type: "date", operator: "between", from: "2026-08-10" } as const

    expect(validateFilterValue(numberFilter).success).toBe(true)
    expect(validateFilterValue(dateFilter).success).toBe(true)
    expect(matchesFilter(5, numberFilter)).toBe(true)
    expect(matchesFilter("2026-09-01", dateFilter)).toBe(true)
  })
})
