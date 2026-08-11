import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  bootstrapOwner: vi.fn(),
  orgRows: [{ id: "org-1" }],
  roleRows: [{ id: "owner-role" }],
}))

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}))

vi.mock("@/db/schema", () => ({
  organization: { createdAt: {}, id: {} },
  roles: { id: {}, name: {}, tenantId: {} },
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({ limit: vi.fn(async () => mocks.orgRows) })),
      })),
    })),
  },
  runInTenant: vi.fn(async (_tenantId: string, callback: (tx: unknown) => Promise<unknown>) => callback({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => mocks.roleRows) })),
      })),
    })),
  })),
}))

vi.mock("@/lib/deployment-seats", () => ({
  bootstrapOwner: mocks.bootstrapOwner,
}))

import { ensureBootstrap } from "@/lib/bootstrap"

describe("bootstrap owner selection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BOOTSTRAP_OWNER_EMAIL = "configured@example.com"
    mocks.bootstrapOwner.mockImplementation(async (input: { mode?: string }) => {
      if (input.mode === "configured") {
        return { memberId: "member-1", result: { allowed: true, reason: "allowed" } }
      }
      throw new Error("bootstrap tenant is already claimed")
    })
  })

  it("preserves the configured bootstrap owner path after another membership exists", async () => {
    await expect(ensureBootstrap("configured-user", " Configured@Example.com ")).resolves.toBe(true)
  })
})
