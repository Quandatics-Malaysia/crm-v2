import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class TestLicenseReadOnlyError extends Error {
    readonly code = "LICENSE_READ_ONLY" as const
  }
  return {
    TestLicenseReadOnlyError,
    assertWriteAllowed: vi.fn(),
    getServerContext: vi.fn(),
    insert: vi.fn(),
    runInTenant: vi.fn(),
  }
})

vi.mock("@/lib/write-access", () => ({
  LICENSE_READ_ONLY: "LICENSE_READ_ONLY",
  LicenseReadOnlyError: mocks.TestLicenseReadOnlyError,
  assertWriteAllowed: mocks.assertWriteAllowed,
}))
vi.mock("@/lib/server-context", () => ({
  getServerContext: mocks.getServerContext,
  requireContext: vi.fn(),
}))
vi.mock("@/db", () => ({
  db: { insert: mocks.insert, delete: vi.fn() },
  runInTenant: mocks.runInTenant,
}))
vi.mock("@/db/schema", () => ({
  organization: { id: {} },
  roles: { id: {}, name: {}, defaultTierLevel: {}, tenantId: {} },
}))
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }))
vi.mock("@/lib/deployment-seats", () => ({
  normalizeSeatEmail: (value: string) => value.trim().toLowerCase(),
  provisionEntitySeats: vi.fn(),
}))

import { createEntity } from "@/app/(app)/_shared/entity-actions"

describe("organization creation commercial boundary", () => {
  it("uses central action runner before creating organization or seed data", async () => {
    mocks.getServerContext.mockResolvedValue({
      userId: "platform-1",
      userEmail: "platform@example.com",
      isSuperadmin: true,
    })
    mocks.assertWriteAllowed.mockRejectedValue(
      new mocks.TestLicenseReadOnlyError("commercial read-only")
    )
    mocks.insert.mockImplementation(() => {
      throw new Error("database touched")
    })

    await expect(createEntity({
      name: "Client Tenant",
      invites: [],
    })).resolves.toEqual({
      ok: false,
      code: "LICENSE_READ_ONLY",
      error: "commercial read-only",
    })
    expect(mocks.assertWriteAllowed).toHaveBeenCalledWith({
      operation: "business_mutation",
    })
    expect(mocks.getServerContext).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.runInTenant).not.toHaveBeenCalled()
  })
})
