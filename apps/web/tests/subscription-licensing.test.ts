import { describe, expect, it } from "vitest"

import { isSubscriptionEntitlementActive } from "@/lib/subscription-licensing"

const now = new Date("2026-08-05T12:00:00.000Z")

describe("subscription entitlement", () => {
  it("is active inside an issued validity window", () => {
    expect(isSubscriptionEntitlementActive(now, {
      status: "active",
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      endsAt: new Date("2026-08-30T23:59:59.999Z"),
    })).toBe(true)
  })

  it("stops access after the validity window", () => {
    expect(isSubscriptionEntitlementActive(now, {
      status: "active",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-08-04T23:59:59.999Z"),
    })).toBe(false)
  })

  it("does not start access before the validity window", () => {
    expect(isSubscriptionEntitlementActive(now, {
      status: "active",
      startsAt: new Date("2026-08-06T00:00:00.000Z"),
      endsAt: new Date("2026-09-04T23:59:59.999Z"),
    })).toBe(false)
  })

  it("blocks paused subscriptions even inside their dates", () => {
    expect(isSubscriptionEntitlementActive(now, {
      status: "paused",
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      endsAt: new Date("2026-08-30T23:59:59.999Z"),
    })).toBe(false)
  })
})
