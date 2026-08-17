import { describe, expect, it } from "vitest"
import { canCreateQuotationRevision } from "./quotation-revision-policy"

describe("quotation revision eligibility", () => {
  const liveEligible = ["sent", "accepted", "rejected", "expired", "void"] as const

  it.each(liveEligible)("allows a live %s quotation", (status) => {
    expect(canCreateQuotationRevision(status, null)).toBe(true)
  })

  it.each(["draft", "pending_approval", "approved"] as const)(
    "rejects a live %s quotation",
    (status) => {
      expect(canCreateQuotationRevision(status, null)).toBe(false)
    }
  )

  it.each(["sent", "accepted", "rejected", "expired", "void"] as const)(
    "allows a soft-deleted %s quotation",
    (status) => {
      expect(canCreateQuotationRevision(status, new Date("2026-08-18T00:00:00Z"))).toBe(true)
    }
  )

  it.each(["draft"] as const)(
    "rejects a soft-deleted %s quotation",
    (status) => {
      expect(canCreateQuotationRevision(status, new Date("2026-08-18T00:00:00Z"))).toBe(false)
    }
  )

  it.each(["pending_approval", "approved"] as const)(
    "allows a soft-deleted %s quotation because it is non-draft history",
    (status) => {
      expect(canCreateQuotationRevision(status, new Date("2026-08-18T00:00:00Z"))).toBe(true)
    }
  )
})
