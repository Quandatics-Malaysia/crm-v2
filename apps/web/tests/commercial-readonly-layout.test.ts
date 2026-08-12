import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getServerContext: vi.fn(),
  getDeploymentAccess: vi.fn(),
  ensureBootstrap: vi.fn(),
  tenantRows: [{ id: "tenant-1", name: "Tenant" }],
}))

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
const layoutMocks = vi.hoisted(() => ({ activeOrganizationStatus: {} }))

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((left, right) => ({ left, right })),
}))
vi.mock("@/db/schema", () => ({
  member: { organizationId: {}, userId: {} },
  organization: { id: {}, name: {}, status: layoutMocks.activeOrganizationStatus },
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => mocks.tenantRows),
        })),
      })),
    })),
  },
}))
vi.mock("@/lib/server-context", () => ({
  getServerContext: mocks.getServerContext,
}))
vi.mock("@/lib/deployment-control", () => ({
  getDeploymentAccess: mocks.getDeploymentAccess,
}))
vi.mock("@/lib/bootstrap", () => ({ ensureBootstrap: mocks.ensureBootstrap }))
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({
    projects: true,
    salesOrders: false,
    finance: false,
    forecast: false,
    audit: false,
    advancedRoles: false,
    documentation: false,
  })),
}))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarInset: vi.fn(),
  SidebarProvider: vi.fn(),
}))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: vi.fn() }))
vi.mock("@/components/create-entity-dialog", () => ({ CreateFirstEntity: vi.fn() }))
vi.mock("@/components/command-palette", () => ({ HeaderActionsProvider: vi.fn() }))

import AppLayout from "@/app/(app)/layout"
import { LicenseReadOnlyError } from "@/lib/write-access"

describe("commercial read-only app shell", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tenantRows = [{ id: "tenant-1", name: "Tenant" }]
  })

  it("keeps records visible and shows signed recovery details", async () => {
    mocks.getServerContext.mockResolvedValue({
      userId: "user-1",
      userName: "Client User",
      userEmail: "client@example.com",
      tenantId: "tenant-1",
      isSuperadmin: false,
      subscriptionInactive: true,
      permissions: new Set(["lead.view"]),
    })
    mocks.getDeploymentAccess.mockResolvedValue({
      mode: "read_only",
      reason: "Lease grace period has ended",
      writeAllowed: false,
      graceUntil: "2026-08-18T00:00:00.000Z",
      recoveryDeadline: null,
    })

    const tree = await AppLayout({
      children: createElement("p", null, "CRM records remain visible"),
    })
    const serialized = JSON.stringify(tree)

    expect(serialized).toContain("CRM records remain visible")
    expect(serialized).toContain("Commercial read-only mode")
    expect(serialized).toContain("Lease grace period has ended")
    expect(serialized).not.toContain("Recovery deadline")
  })

  it("shows no-organization access when read-only blocks bootstrap", async () => {
    mocks.tenantRows = []
    mocks.getServerContext.mockResolvedValue({
      userId: "new-user",
      userName: "Invited User",
      userEmail: "invited@example.com",
      tenantId: "",
      isSuperadmin: false,
      subscriptionInactive: false,
      permissions: new Set(),
    })
    mocks.ensureBootstrap.mockRejectedValue(new LicenseReadOnlyError({
      operation: "membership_mutation",
      reason: "Subscription is suspended",
      recoveryDeadline: null,
    }))

    const tree = await AppLayout({ children: "must not render" })
    const serialized = JSON.stringify(tree)

    expect(serialized).toContain("No organization access yet")
    expect(serialized).not.toContain("must not render")
    expect(mocks.ensureBootstrap).toHaveBeenCalledOnce()
  })

  it("filters archived organizations from the tenant switcher query", async () => {
    mocks.getServerContext.mockResolvedValue({
      userId: "user-1",
      userName: "Client User",
      userEmail: "client@example.com",
      tenantId: "tenant-1",
      tenantArchived: false,
      isSuperadmin: false,
      subscriptionInactive: false,
      permissions: new Set(["lead.view"]),
    })
    mocks.getDeploymentAccess.mockResolvedValue({
      mode: "active",
      reason: "Active",
      writeAllowed: true,
      recoveryDeadline: null,
    })

    await AppLayout({ children: "content" })

    const { eq } = await import("drizzle-orm")
    expect(eq).toHaveBeenCalledWith(layoutMocks.activeOrganizationStatus, "active")
  })
})
