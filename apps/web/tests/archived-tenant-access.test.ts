import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  activeOrganizationId: null as string | null,
  isSuperadmin: false,
  memberships: [] as Array<{
    member: { id: string; organizationId: string; createdAt: Date }
    organizationStatus: "active" | "archived"
  }>,
  setActiveOrganization: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "user-1", name: "User", email: "user@example.com" },
        session: { activeOrganizationId: mocks.activeOrganizationId },
      })),
      setActiveOrganization: mocks.setActiveOrganization,
    },
  },
}))
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  asc: vi.fn((column) => column),
  eq: vi.fn((left, right) => ({ left, right })),
  inArray: vi.fn((column, values) => ({ column, values })),
}))
vi.mock("@/db/schema", () => ({
  user: { id: {}, isSuperadmin: {}, isVendorSupport: {} },
  member: { id: {}, userId: {}, organizationId: {}, createdAt: {} },
  organization: { id: {}, status: {} },
  membershipProfiles: { memberId: {}, tierLevel: {}, status: {}, roleId: {} },
  memberRoles: { memberId: {}, roleId: {} },
  roles: { id: {}, name: {} },
  rolePermissions: { roleId: {}, permissionId: {} },
  permissions: { id: {}, key: {} },
  tenantSettings: {
    organizationId: {},
    status: {},
    subscriptionStatus: {},
    subscriptionStartsAt: {},
    subscriptionEndsAt: {},
  },
}))
vi.mock("@/lib/subscription-licensing", () => ({
  isSubscriptionEntitlementActive: vi.fn(() => true),
}))
vi.mock("@/db", () => {
  const chain = (rows: unknown[]) => {
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => rows),
      then: <T>(resolve: (value: unknown[]) => T, reject?: (reason: unknown) => T) =>
        Promise.resolve(rows).then(resolve, reject),
    }
    return query
  }

  return {
    db: {
      select: vi.fn(() => {
        const call = mocksDbSelectCalls++ % 2
        return chain(call === 0 ? mocks.memberships : [{
          isSuperadmin: mocks.isSuperadmin,
          isVendorSupport: false,
        }])
      }),
    },
    runInTenant: vi.fn(async (_tenantId, callback) => {
      const rows = [
        [{ tierLevel: 1, status: "active", roleId: null }],
        [{ status: "active", subscriptionStatus: "active", subscriptionStartsAt: null, subscriptionEndsAt: null }],
        [],
        [],
      ]
      let call = 0
      return callback({ select: vi.fn(() => chain(rows[call++] ?? [])) })
    }),
  }
})

let mocksDbSelectCalls = 0

import {
  getServerContext,
  hasStandingTenantAccess,
  requireContext,
} from "@/lib/server-context"

function membership(
  id: string,
  status: "active" | "archived",
  createdAt: string,
) {
  return {
    member: { id: `member-${id}`, organizationId: id, createdAt: new Date(createdAt) },
    organizationStatus: status,
  }
}

describe("archived tenant access", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocksDbSelectCalls = 0
    mocks.activeOrganizationId = null
    mocks.isSuperadmin = false
    mocks.memberships = []
  })

  it("falls back to the oldest active organization", async () => {
    mocks.memberships = [
      membership("older", "active", "2026-01-01"),
      membership("newer", "active", "2026-02-01"),
    ]

    const context = await getServerContext()

    expect(context?.tenantId).toBe("older")
    expect(context?.tenantArchived).toBe(false)
    expect(mocks.setActiveOrganization).toHaveBeenCalledWith(expect.objectContaining({
      body: { organizationId: "older" },
    }))
  })

  it("replaces an archived active-session organization with the oldest active organization", async () => {
    mocks.activeOrganizationId = "archived"
    mocks.memberships = [
      membership("archived", "archived", "2026-01-01"),
      membership("active", "active", "2026-02-01"),
    ]

    const context = await getServerContext()

    expect(context?.tenantId).toBe("active")
    expect(context?.tenantArchived).toBe(false)
    expect(mocks.setActiveOrganization).toHaveBeenCalledWith(expect.objectContaining({
      body: { organizationId: "active" },
    }))
  })

  it("does not fall back to an archived-only membership", async () => {
    mocks.memberships = [membership("archived", "archived", "2026-01-01")]

    const context = await getServerContext()

    expect(context?.tenantId).toBe("")
    expect(context?.tenantArchived).toBe(true)
  })

  it("denies an archived active-session organization before permissions", async () => {
    mocks.activeOrganizationId = "archived"
    mocks.memberships = [membership("archived", "archived", "2026-01-01")]

    const context = await getServerContext()

    expect(context?.tenantId).toBe("archived")
    expect(context?.tenantArchived).toBe(true)
    expect(hasStandingTenantAccess(context!)).toBe(false)
    expect(context?.can("lead.view")).toBe(false)
    await expect(requireContext()).rejects.toThrow("ORGANIZATION_ARCHIVED")
  })

  it("does not let a superadmin membership bypass archived access denial", async () => {
    mocks.activeOrganizationId = "archived"
    mocks.isSuperadmin = true
    mocks.memberships = [membership("archived", "archived", "2026-01-01")]

    const context = await getServerContext()

    expect(context?.isSuperadmin).toBe(true)
    expect(context?.can("lead.view")).toBe(false)
    await expect(requireContext()).rejects.toThrow("ORGANIZATION_ARCHIVED")
  })

  it("does not let an archived-only superadmin without a session tenant retain permissions", async () => {
    mocks.isSuperadmin = true
    mocks.memberships = [membership("archived", "archived", "2026-01-01")]

    const context = await getServerContext()

    expect(context?.tenantId).toBe("")
    expect(context?.tenantArchived).toBe(true)
    expect(context?.can("lead.view")).toBe(false)
    await expect(requireContext()).rejects.toThrow("ORGANIZATION_ARCHIVED")
  })
})
