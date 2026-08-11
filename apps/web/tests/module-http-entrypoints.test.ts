import { beforeEach, describe, expect, it, vi } from "vitest"

import { funnels, persons, projects } from "@/db/schema"
import { createDisabledModuleMap, type ModuleId } from "@/lib/module-registry"

const mocks = vi.hoisted(() => {
  class TestModuleAccessDeniedError extends Error {
    constructor(readonly moduleId: string) {
      super(`The ${moduleId} module is not licensed.`)
      this.name = "ModuleAccessDeniedError"
    }
  }
  return {
    map: {
      projects: false,
      salesOrders: false,
      finance: false,
      forecast: false,
      audit: false,
      advancedRoles: false,
      documentation: false,
    },
    TestModuleAccessDeniedError,
    requireModule: vi.fn(),
    requireRoute: vi.fn(),
    redirect: vi.fn(),
    runInTenant: vi.fn(),
    withApiTenant: vi.fn(),
    storageGet: vi.fn(),
  }
})

vi.mock("@/lib/modules.server", () => ({
  ModuleAccessDeniedError: mocks.TestModuleAccessDeniedError,
  getEntitledModuleMap: vi.fn(async () => mocks.map),
  requireEntitledModule: mocks.requireModule,
}))

vi.mock("@/lib/module-guard", () => ({
  requireEntitledRoute: mocks.requireRoute,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/server-context", () => ({
  getServerContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    memberId: "member-1",
    isSuperadmin: true,
    can: () => true,
  })),
}))

vi.mock("@/db", () => ({
  runInTenant: mocks.runInTenant,
}))

vi.mock("@/lib/storage", () => ({
  storage: { get: mocks.storageGet },
}))

vi.mock("@/lib/api-auth", () => ({
  getApiContext: vi.fn(async () => ({ tenantId: "tenant-1" })),
  withApiTenant: mocks.withApiTenant,
}))

import BillingSettingsIndex from "@/app/(app)/settings/billing/page"
import { GET as getFile } from "@/app/api/files/[id]/route"
import { GET as getApiDetail } from "@/app/api/v1/[resource]/[id]/route"
import { maybeCompleteProject } from "@/server/services/finance"

function attachmentTx() {
  const value = [{
    fileName: "invoice.pdf",
    contentType: "application/pdf",
    storageKey: "secret-key",
    attachableType: "finance_doc",
    attachableId: "invoice-1",
  }]
  const promise = Promise.resolve(value)
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: promise.then.bind(promise),
  }
  return { select: vi.fn(() => chain) }
}

function readerTx(entries: Array<[object, unknown[]]>) {
  const queues = new Map(entries.map(([table, values]) => [table, [...values]]))
  return {
    select: vi.fn(() => {
      let value: unknown = []
      const query: Record<string, unknown> = {
        from: vi.fn((table: object) => {
          value = queues.get(table)?.shift() ?? []
          return query
        }),
        innerJoin: vi.fn(() => query),
        leftJoin: vi.fn(() => query),
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve(value).then(resolve, reject),
      }
      return query
    }),
  }
}

describe("direct route, file, API, and service entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.map = createDisabledModuleMap()
    mocks.requireModule.mockImplementation(async (id: ModuleId) => {
      if (!mocks.map[id]) throw new mocks.TestModuleAccessDeniedError(id)
    })
    mocks.requireRoute.mockImplementation(async (id: ModuleId) => {
      await mocks.requireModule(id)
    })
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`)
    })
  })

  it("keeps the core quotation-numbering settings redirect reachable", () => {
    expect(() => BillingSettingsIndex()).toThrow(
      "redirect:/settings/billing/numbering"
    )
    expect(mocks.requireRoute).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledWith("/settings/billing/numbering")
  })

  it("denies a finance attachment before storage download", async () => {
    const tx = attachmentTx()
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const response = await getFile(
      new Request("http://localhost/api/files/file-1?dl=1"),
      { params: Promise.resolve({ id: "file-1" }) }
    )

    expect(response.status).toBe(403)
    expect(mocks.storageGet).not.toHaveBeenCalled()
  })

  it("does not expose nested projects through the core persons API", async () => {
    const tx = readerTx([
      [persons, [[{ person: { id: "person-1" }, accountName: "Acme", accountOwner: "member-1" }]]],
      [funnels, [[{ id: "funnel-1", name: "Deal" }]]],
      [projects, [[{ id: "project-secret", name: "Secret project" }]]],
    ])
    mocks.withApiTenant.mockImplementation(async (_ctx, _permission, work) =>
      work(tx, {
        tenantId: "tenant-1",
        memberId: "member-1",
        isSuperadmin: true,
        can: () => true,
      })
    )

    const response = await getApiDetail(
      new Request("http://localhost/api/v1/persons/person-1"),
      { params: Promise.resolve({ resource: "persons", id: "person-1" }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { projects: [] } })
  })

  it("does not let a disabled finance service touch tenant data", async () => {
    const tx = { select: vi.fn() }

    await maybeCompleteProject(tx as never, {} as never, "project-1")

    expect(tx.select).not.toHaveBeenCalled()
  })
})
