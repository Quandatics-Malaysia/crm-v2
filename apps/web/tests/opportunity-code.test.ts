import { describe, expect, it } from "vitest"
import {
  nextOpportunityNumber,
  formatOpportunityCode,
  formatFunnelName,
  pickPpvvc,
} from "@/lib/opportunity-code"

describe("nextOpportunityNumber", () => {
  it("starts at 1 when none exist", () => {
    expect(nextOpportunityNumber([])).toBe(1)
  })
  it("is max + 1, gap-tolerant", () => {
    expect(nextOpportunityNumber([1, 2, 5])).toBe(6)
    expect(nextOpportunityNumber([3])).toBe(4)
  })
})

describe("formatOpportunityCode", () => {
  it("normalizes the organization code and formats the approved code", () => {
    expect(
      formatOpportunityCode({ organizationCode: " qm-01 ", year: 2026, number: 1 })
    ).toBe("QM01OPP-2026-0001")
    expect(
      formatOpportunityCode({ organizationCode: "qm", year: 2026, number: 42 })
    ).toBe("QMOPP-2026-0042")
  })

  it("preserves running numbers wider than the padding width", () => {
    expect(
      formatOpportunityCode({ organizationCode: "QM", year: 2026, number: 12345 })
    ).toBe("QMOPP-2026-12345")
  })

  it("rejects a missing or non-alphanumeric organization code", () => {
    expect(() =>
      formatOpportunityCode({ organizationCode: "---", year: 2026, number: 1 })
    ).toThrow("Organization code is required")
  })
})

describe("formatFunnelName", () => {
  it("full: year company Project - products", () => {
    expect(
      formatFunnelName({
        projectYear: 2026,
        companyCode: "qm",
        isRenewal: false,
        products: "License + AMS",
      })
    ).toBe("2026 QM Project - License + AMS")
  })
  it("renewal label", () => {
    expect(
      formatFunnelName({ projectYear: 2026, companyCode: "QM", isRenewal: true, products: "License" })
    ).toBe("2026 QM Renewal - License")
  })
  it("omits missing segments without dangling separators", () => {
    expect(formatFunnelName({ projectYear: 2026, companyCode: "QM" })).toBe("2026 QM Project")
    expect(formatFunnelName({ products: "X" })).toBe("Project - X")
  })
})

describe("pickPpvvc", () => {
  it("extracts only the five fields, null-filling", () => {
    expect(pickPpvvc({ pain: "budget", power: "CFO", extra: "ignored" } as never)).toEqual({
      pain: "budget",
      power: "CFO",
      vision: null,
      value: null,
      control: null,
    })
  })
  it("handles null/undefined", () => {
    expect(pickPpvvc(null)).toEqual({})
  })
})
