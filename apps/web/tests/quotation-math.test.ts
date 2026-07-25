import { describe, expect, it } from "vitest"
import { computeQuotation } from "@/server/services/quotation-math"

/** The documented reconciliation invariant, checked on every case. */
function assertReconciles(t: ReturnType<typeof computeQuotation>) {
  expect(t.subtotal + t.taxTotal - t.discountTotal).toBeCloseTo(t.total, 2)
  const sumSub = t.lines.reduce((s, l) => s + l.lineSubtotal, 0)
  const sumTax = t.lines.reduce((s, l) => s + l.lineTax, 0)
  const sumTot = t.lines.reduce((s, l) => s + l.lineTotal, 0)
  expect(sumSub).toBeCloseTo(t.subtotal, 2)
  expect(sumTax).toBeCloseTo(t.taxTotal, 2)
  expect(sumTot).toBeCloseTo(t.total, 2)
}

describe("computeQuotation", () => {
  it("computes a simple tax-exclusive quote", () => {
    const t = computeQuotation({
      lines: [{ quantity: 2, unitPrice: 100 }],
      ratePercent: 6,
    })
    expect(t.subtotal).toBe(200)
    expect(t.taxTotal).toBe(12)
    expect(t.total).toBe(212)
    assertReconciles(t)
  })

  it("divides tax out of tax-inclusive prices", () => {
    const t = computeQuotation({
      lines: [{ quantity: 1, unitPrice: 106 }],
      ratePercent: 6,
      taxInclusive: true,
    })
    expect(t.subtotal).toBe(100)
    expect(t.taxTotal).toBe(6)
    expect(t.total).toBe(106)
    assertReconciles(t)
  })

  it("applies absolute line discounts, clamped at zero", () => {
    const t = computeQuotation({
      lines: [
        { quantity: 1, unitPrice: 100, discountAmount: 30 },
        { quantity: 1, unitPrice: 50, discountAmount: 999 }, // over-discounted → 0
      ],
      ratePercent: 0,
    })
    expect(t.subtotal).toBe(70)
    expect(t.total).toBe(70)
    assertReconciles(t)
  })

  it("allocates the header discount pro-rata and reconciles per line", () => {
    const t = computeQuotation({
      lines: [
        { quantity: 1, unitPrice: 100 },
        { quantity: 1, unitPrice: 200 },
      ],
      ratePercent: 8,
      headerDiscount: 30,
    })
    expect(t.subtotal).toBe(300)
    expect(t.discountTotal).toBe(30)
    expect(t.taxTotal).toBeCloseTo(21.6, 2)
    expect(t.total).toBeCloseTo(291.6, 2)
    assertReconciles(t)
  })

  it("clamps the header discount to the subtotal", () => {
    const t = computeQuotation({
      lines: [{ quantity: 1, unitPrice: 100 }],
      ratePercent: 6,
      headerDiscount: 500,
    })
    expect(t.discountTotal).toBe(100)
    expect(t.total).toBe(0)
    assertReconciles(t)
  })

  it("reconciles with many awkward lines (rounding absorption)", () => {
    const t = computeQuotation({
      lines: Array.from({ length: 7 }, (_, i) => ({
        quantity: "1.333",
        unitPrice: String(9.99 + i * 0.07),
        discountAmount: "0.11",
      })),
      ratePercent: "6",
      headerDiscount: "5.55",
      taxInclusive: false,
    })
    assertReconciles(t)
  })

  it("handles an empty quote and garbage inputs safely", () => {
    const empty = computeQuotation({ lines: [], ratePercent: 6 })
    expect(empty.total).toBe(0)
    const garbage = computeQuotation({
      lines: [{ quantity: "abc", unitPrice: "xyz" }],
      ratePercent: "not-a-number",
    })
    expect(garbage.total).toBe(0)
    assertReconciles(garbage)
  })
})
