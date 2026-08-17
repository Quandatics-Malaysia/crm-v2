import { describe, expect, it } from "vitest"
import { canSelectTenant, resolveTenantId } from "@/lib/superadmin-tenant-access"

describe("superadmin tenant access", () => {
  it("allows a superadmin to select an organisation without membership", () => {
    expect(
      canSelectTenant({
        isSuperadmin: true,
        tenantId: "cc",
        memberTenantIds: ["demo-entity"],
      })
    ).toBe(true)
  })

  it("keeps normal users limited to their memberships", () => {
    expect(
      canSelectTenant({
        isSuperadmin: false,
        tenantId: "cc",
        memberTenantIds: ["demo-entity"],
      })
    ).toBe(false)
  })

  it("falls back to the first valid organisation when a stale selection is used", () => {
    expect(
      resolveTenantId({
        isSuperadmin: true,
        requestedTenantId: "removed-org",
        sessionTenantId: "also-removed",
        memberTenantIds: ["demo-entity"],
        organizationIds: ["cc", "qar"],
      })
    ).toBe("cc")
  })
})
