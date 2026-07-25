import { describe, it, expect } from "vitest"
import {
  intercoShare,
  deriveRecognizedPercent,
  partyShare,
  deriveOriginRecognizedPercent,
  deriveOriginRecognizedAmount,
  validatePartyShares,
} from "@/lib/interco-share"

describe("intercoShare — absolute leg mode", () => {
  it("splits N partial invoices proportionally and sums to the leg", () => {
    // 100k deal, partner leg = 70k, milestones 30/40/30.
    const leg = 70000
    const total = 100000
    const s1 = intercoShare({ legAmount: leg, recognizedPercent: null, dealTotal: total, invoiceAmount: 30000 })
    const s2 = intercoShare({ legAmount: leg, recognizedPercent: null, dealTotal: total, invoiceAmount: 40000 })
    const s3 = intercoShare({ legAmount: leg, recognizedPercent: null, dealTotal: total, invoiceAmount: 30000 })
    expect(s1).toBe(21000)
    expect(s2).toBe(28000)
    expect(s3).toBe(21000)
    expect(s1 + s2 + s3).toBe(leg)
  })

  it("never mirrors more than the leg", () => {
    const s = intercoShare({ legAmount: 70000, recognizedPercent: null, dealTotal: 100000, invoiceAmount: 200000 })
    expect(s).toBe(70000)
  })

  it("falls back to the full leg with no basis", () => {
    const s = intercoShare({ legAmount: 5000, recognizedPercent: null, dealTotal: 0, invoiceAmount: 5000 })
    expect(s).toBe(5000)
  })
})

describe("intercoShare — percent mode (regression: unchanged)", () => {
  it("matches the original 100 − recognizedPercent formula", () => {
    // recognizedPercent 30 → partner gets 70% of the invoice.
    const s = intercoShare({ legAmount: null, recognizedPercent: 30, dealTotal: 100000, invoiceAmount: 100000 })
    expect(s).toBe(70000)
  })

  it("returns 0 when nothing is derivable", () => {
    expect(intercoShare({ legAmount: null, recognizedPercent: null, dealTotal: 100000, invoiceAmount: 100000 })).toBe(0)
  })
})

describe("deriveRecognizedPercent", () => {
  it("derives the origin cut from an absolute leg", () => {
    // 100k basis, 70k leg → origin keeps 30%.
    expect(deriveRecognizedPercent(100000, 70000)).toBe(30)
  })

  it("clamps and handles no basis", () => {
    expect(deriveRecognizedPercent(0, 70000)).toBeNull()
    expect(deriveRecognizedPercent(100000, 120000)).toBe(0) // leg > basis → 0% recognized
  })
})

describe("partyShare — N-party, independent (not complement)", () => {
  it("splits a 100k invoice across 3 parties with mixed share types", () => {
    const dealTotal = 100000
    const a = partyShare({ shareType: "amount", shareValue: 30000 }, dealTotal, 100000)
    const b = partyShare({ shareType: "percent", shareValue: 20 }, dealTotal, 100000)
    const c = partyShare({ shareType: "amount", shareValue: 10000 }, dealTotal, 100000)
    expect(a).toBe(30000)
    expect(b).toBe(20000)
    expect(c).toBe(10000)
    // Origin keeps the remainder: 100000 - 30000 - 20000 - 10000 = 40000.
    expect(dealTotal - (a + b + c)).toBe(40000)
  })

  it("percent mode is the party's own cut, not a complement", () => {
    // Two 20% parties each get 20% of the invoice — not 80% each.
    const share = partyShare({ shareType: "percent", shareValue: 20 }, 100000, 50000)
    expect(share).toBe(10000)
  })
})

describe("deriveOriginRecognizedPercent", () => {
  it("sums percent + amount parties into the origin's remaining cut", () => {
    // 100k basis: one 20% party + one 30k amount party (30%) → origin keeps 50%.
    const pct = deriveOriginRecognizedPercent(100000, [
      { shareType: "percent", shareValue: 20 },
      { shareType: "amount", shareValue: 30000 },
    ])
    expect(pct).toBe(50)
  })

  it("clamps and handles no basis", () => {
    expect(deriveOriginRecognizedPercent(0, [])).toBeNull()
    expect(
      deriveOriginRecognizedPercent(100000, [
        { shareType: "amount", shareValue: 120000 },
      ])
    ).toBe(0)
  })
})

describe("deriveOriginRecognizedAmount — exact money (regression: RM42.40 bug)", () => {
  it("fixed-amount leg yields an exact recognized cut, not a rounded-percent recompute", () => {
    // The reported defect: RM879,306 fixed leg on a RM1,018,000 deal.
    // Correct = 1,018,000 − 879,306 = 138,694.00 (NOT 138,651.60, which is
    // what basis × round2(13.6242%) produced).
    expect(
      deriveOriginRecognizedAmount(1018000, [
        { shareType: "amount", shareValue: 879306 },
      ])
    ).toBe(138694)
  })

  it("percent party and mixed multi-party splits are exact to the cent", () => {
    // 100k basis, one 20% party → origin keeps 80,000.
    expect(
      deriveOriginRecognizedAmount(100000, [{ shareType: "percent", shareValue: 20 }])
    ).toBe(80000)
    // 100k basis: 20% party + 30k amount party → 100,000 − 20,000 − 30,000 = 50,000.
    expect(
      deriveOriginRecognizedAmount(100000, [
        { shareType: "percent", shareValue: 20 },
        { shareType: "amount", shareValue: 30000 },
      ])
    ).toBe(50000)
  })

  it("clamps to [0, basis] and returns 0 with no basis", () => {
    expect(deriveOriginRecognizedAmount(0, [])).toBe(0)
    expect(
      deriveOriginRecognizedAmount(100000, [{ shareType: "amount", shareValue: 120000 }])
    ).toBe(0)
  })
})

describe("validatePartyShares", () => {
  const p = (partnerEntityId: string, shareType: "percent" | "amount", shareValue: number) => ({
    partnerEntityId,
    shareType,
    shareValue,
  })

  it("accepts a valid 3-party split", () => {
    expect(
      validatePartyShares(
        [p("a", "amount", 30000), p("b", "percent", 20), p("c", "amount", 10000)],
        100000
      )
    ).toEqual({ ok: true })
  })

  it("rejects an empty party list", () => {
    expect(validatePartyShares([], 100000).ok).toBe(false)
  })

  it("rejects more than MAX_INTERCOMPANY_PARTIES", () => {
    const parties = Array.from({ length: 11 }, (_, i) => p(`e${i}`, "amount", 1))
    expect(validatePartyShares(parties, 100000).ok).toBe(false)
  })

  it("rejects a duplicate partner entity", () => {
    expect(
      validatePartyShares([p("a", "amount", 1000), p("a", "amount", 2000)], 100000).ok
    ).toBe(false)
  })

  it("rejects percent shares summing over 100%", () => {
    expect(
      validatePartyShares([p("a", "percent", 60), p("b", "percent", 50)], 100000).ok
    ).toBe(false)
  })

  it("rejects an amount leg exceeding the deal total", () => {
    expect(validatePartyShares([p("a", "amount", 200000)], 100000).ok).toBe(false)
  })
})
