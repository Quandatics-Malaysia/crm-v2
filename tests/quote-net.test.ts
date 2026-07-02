import { describe, expect, it } from "vitest"
import { quoteNet } from "@/server/services/value"

describe("quoteNet", () => {
  it("is subtotal minus discount, as a 2dp string", () => {
    expect(quoteNet({ subtotal: "1000.00", discountTotal: "150.50" })).toBe(
      "849.50"
    )
  })

  it("treats nulls as zero", () => {
    expect(quoteNet({ subtotal: null, discountTotal: null })).toBe("0.00")
    expect(quoteNet({ subtotal: "100", discountTotal: null })).toBe("100.00")
  })

  it("never returns NaN for garbage input", () => {
    expect(
      quoteNet({ subtotal: "abc" as string, discountTotal: "1" })
    ).toBe("0.00")
  })
})
