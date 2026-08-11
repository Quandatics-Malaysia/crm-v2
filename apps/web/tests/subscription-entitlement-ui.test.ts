import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

import { SubscriptionClient } from "@/app/(app)/settings/subscription/subscription-client"
import type { SubscriptionEntitlementView } from "@/app/(app)/settings/subscription/actions"

describe("client subscription entitlement UI", () => {
  it("renders exact signed read-only details with no local commercial editor", () => {
    const data: SubscriptionEntitlementView = {
      mode: "read_only",
      reason: "Subscription is suspended",
      writeAllowed: false,
      subscriptionStatus: "suspended",
      planId: "growth-annual",
      seatLimit: 25,
      moduleIds: ["projects", "salesOrders"],
      leaseExpiresAt: "2026-08-11T00:00:00.000Z",
      recoveryDeadline: null,
      contractStartsAt: "2026-08-01T00:00:00.000Z",
      contractEndsAt: "2027-08-01T00:00:00.000Z",
      revision: 7,
      configurationVersion: "config-7",
    }

    const html = renderToStaticMarkup(
      createElement(SubscriptionClient, { data })
    )

    expect(html).toContain("Read-only")
    expect(html).toContain("Subscription is suspended")
    expect(html).not.toContain("Recovery deadline")
    expect(html).not.toContain("2026-08-18T00:00:00.000Z")
    expect(html).toContain("growth-annual")
    expect(html).not.toMatch(/Issue invoice|Seats granted|Monthly price|<input|<button/i)
    expect(html).not.toMatch(/signature|private key|public key|keyId/i)
  })

  it.each([
    ["active", "past_due", null, false],
    ["grace", "past_due", "2026-08-18T00:00:00.000Z", true],
    ["read_only", "active", null, false],
    ["read_only", "suspended", null, false],
    ["read_only", "cancelled", null, false],
  ] as const)(
    "shows a recovery deadline only for semantic grace mode (%s/%s)",
    (mode, subscriptionStatus, recoveryDeadline, expected) => {
      const data: SubscriptionEntitlementView = {
        mode,
        reason: "Commercial state",
        writeAllowed: mode !== "read_only",
        subscriptionStatus,
        planId: "growth-annual",
        seatLimit: 25,
        moduleIds: ["projects"],
        leaseExpiresAt: "2026-08-11T00:00:00.000Z",
        recoveryDeadline,
        contractStartsAt: "2026-08-01T00:00:00.000Z",
        contractEndsAt: "2027-08-01T00:00:00.000Z",
        revision: 7,
        configurationVersion: "config-7",
      }

      const html = renderToStaticMarkup(createElement(SubscriptionClient, { data }))

      expect(html.includes("Recovery deadline")).toBe(expected)
      expect(html.includes("2026-08-18T00:00:00.000Z")).toBe(expected)
    }
  )
})
