import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getServerContext: vi.fn(),
  getDeploymentAccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }))
vi.mock("@/db/schema", () => ({
  member: { organizationId: {}, userId: {} },
  organization: { id: {}, name: {} },
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => [{ id: "tenant-1", name: "Tenant" }]),
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
vi.mock("@/lib/bootstrap", () => ({ ensureBootstrap: vi.fn() }))
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

describe("commercial read-only app shell", () => {
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
    })

    const tree = await AppLayout({
      children: createElement("p", null, "CRM records remain visible"),
    })
    const serialized = JSON.stringify(tree)

    expect(serialized).toContain("CRM records remain visible")
    expect(serialized).toContain("Commercial read-only mode")
    expect(serialized).toContain("Lease grace period has ended")
    expect(serialized).toContain("2026-08-18T00:00:00.000Z")
  })
})
