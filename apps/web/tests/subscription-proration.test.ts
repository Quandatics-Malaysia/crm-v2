import { describe, expect, it } from "vitest"
import {
  calculateProratedSeatCharge,
  calculateProrationFraction,
} from "@/lib/subscription-proration"

describe("calculateProratedSeatCharge", () => {
  it("charges the remaining fraction of a fixed term", () => {
    expect(calculateProratedSeatCharge({
      seatPrice: 1200,
      additionalSeats: 1,
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2027-01-01T00:00:00Z"),
      now: new Date("2026-07-02T12:00:00Z"),
    })).toBe(600)
  })

  it("charges full price when no term is configured", () => {
    expect(calculateProratedSeatCharge({
      seatPrice: 100,
      additionalSeats: 3,
      startsAt: null,
      endsAt: null,
    })).toBe(300)
  })

  it("never charges after the term ends", () => {
    expect(calculateProratedSeatCharge({
      seatPrice: 1200,
      additionalSeats: 1,
      startsAt: new Date("2025-01-01T00:00:00Z"),
      endsAt: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-08-05T00:00:00Z"),
    })).toBe(0)
  })

  it("charges the full term before the subscription starts", () => {
    expect(calculateProrationFraction({
      startsAt: new Date("2027-01-01T00:00:00Z"),
      endsAt: new Date("2028-01-01T00:00:00Z"),
      now: new Date("2026-12-01T00:00:00Z"),
    })).toBe(1)
  })

  it("returns zero remaining fraction after expiry", () => {
    expect(calculateProrationFraction({
      startsAt: new Date("2025-01-01T00:00:00Z"),
      endsAt: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-08-05T00:00:00Z"),
    })).toBe(0)
  })
})
