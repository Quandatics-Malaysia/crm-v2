import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

import SubscriptionSettingsPage from "@/app/(app)/settings/subscription/page"

describe("client subscription entitlement UI", () => {
  it("renders vendor-managed read-only subscription notice", async () => {
    const html = renderToStaticMarkup(await SubscriptionSettingsPage())

    expect(html).toContain("Commercial access is managed by your vendor")
    expect(html).toContain("Contact your Quandatics operator")
    expect(html).not.toContain("Issue invoice")
    expect(html).not.toMatch(/<input|<button/i)
    expect(html).not.toMatch(/signature|private key|public key|keyId/i)
  })

  it("does not expose subscription editor controls", async () => {
    const html = renderToStaticMarkup(await SubscriptionSettingsPage())

    expect(html).not.toContain("Recovery deadline")
    expect(html).not.toMatch(/Seats granted|Monthly price|Subscription is suspended/i)
  })
})
