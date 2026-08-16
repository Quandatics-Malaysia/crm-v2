import { beforeEach, describe, expect, it, vi } from "vitest"

const apiAuthMocks = vi.hoisted(() => ({
  getApiContext: vi.fn(),
  withApiTenant: vi.fn(),
}))

const accessScopeMocks = vi.hoisted(() => ({
  visibleMemberIds: vi.fn(),
  ownsOrManages: vi.fn(),
  canManageAllRecords: vi.fn(),
}))

const templateApiMocks = vi.hoisted(() => ({
  getQuotationTemplateByCode: vi.fn(),
  getQuotationTemplateByCodeForUpdate: vi.fn(),
  getTenantQuotationTemplateCode: vi.fn(),
  listQuotationTemplates: vi.fn(),
  updateTenantQuotationTemplateCode: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => apiAuthMocks)
vi.mock("@/lib/access-scope", () => accessScopeMocks)
vi.mock("@/lib/quotation-template-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quotation-template-api")>(
    "@/lib/quotation-template-api"
  )
  return {
    ...actual,
    getQuotationTemplateByCode: templateApiMocks.getQuotationTemplateByCode,
    getQuotationTemplateByCodeForUpdate: templateApiMocks.getQuotationTemplateByCodeForUpdate,
    getTenantQuotationTemplateCode: templateApiMocks.getTenantQuotationTemplateCode,
    listQuotationTemplates: templateApiMocks.listQuotationTemplates,
    updateTenantQuotationTemplateCode: templateApiMocks.updateTenantQuotationTemplateCode,
  }
})

import { GET as getTemplates, POST as createTemplate } from "@/app/api/v1/quotation-templates/route"
import {
  DELETE as deleteTemplate,
  GET as getTemplateByCode,
  PATCH as patchTemplate,
} from "@/app/api/v1/quotation-templates/[code]/route"
import {
  GET as getAccountTemplate,
  PATCH as patchAccountTemplate,
} from "@/app/api/v1/accounts/[id]/quotation-template-code/route"
import {
  GET as getTenantDefault,
  PATCH as patchTenantDefault,
} from "@/app/api/v1/quotation-templates/default/route"

function makeTx() {
  const returning = vi.fn(async () => [
    {
      id: "t-1",
      organizationId: "tenant-1",
      code: "cc",
      label: "CC Template",
      legacyTemplateCode: "cc",
      renderMode: "builtin",
      htmlTemplate: null,
      cssTemplate: null,
      notes: null,
      isActive: true,
    },
  ])

  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning,
        })),
      })),
    })),
  }
}

describe("quotation template API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiAuthMocks.getApiContext.mockResolvedValue({ tenantId: "tenant-1", can: () => true })
    apiAuthMocks.withApiTenant.mockImplementation(async (_ctx, _permission, fn) => {
      return fn(makeTx() as never, _ctx as never)
    })
    accessScopeMocks.visibleMemberIds.mockResolvedValue(null)
    accessScopeMocks.ownsOrManages.mockReturnValue(true)
    accessScopeMocks.canManageAllRecords.mockReturnValue(true)
  })

  it("returns unauthorized when API key missing", async () => {
    apiAuthMocks.getApiContext.mockResolvedValue(null)

    const response = await getTemplates(new Request("http://localhost/api/v1/quotation-templates"))

    expect(response.status).toBe(401)
    expect(apiAuthMocks.withApiTenant).not.toHaveBeenCalled()
  })

  it("lists quotation templates", async () => {
    const listedTemplate = {
      id: "t-1",
      code: "cc",
      label: "CC",
      isActive: true,
      legacyTemplateCode: null,
      renderMode: "builtin" as const,
    }

    templateApiMocks.listQuotationTemplates.mockResolvedValue([listedTemplate])

    const response = await getTemplates(new Request("http://localhost/api/v1/quotation-templates"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      data: [{ code: "cc", label: "CC" }],
    })
  })

  it("creates a template", async () => {
    templateApiMocks.getQuotationTemplateByCode.mockResolvedValue(null)

    const response = await createTemplate(
      new Request("http://localhost/api/v1/quotation-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "cc",
          label: "CC Template",
          renderMode: "builtin",
        }),
      })
    )

    const payload = await response.json()
    expect(response.status).toBe(201)
    expect(payload.data).toMatchObject({ code: "cc" })
  })

  it("rejects duplicate template code", async () => {
    templateApiMocks.getQuotationTemplateByCode.mockResolvedValue({ code: "cc", label: "x" } as never)

    const response = await createTemplate(
      new Request("http://localhost/api/v1/quotation-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "cc",
          label: "CC Template",
          renderMode: "builtin",
        }),
      })
    )

    const payload = await response.json()
    expect(response.status).toBe(409)
    expect(payload).toMatchObject({ error: { code: "conflict" } })
  })

  it("updates a template only when body has changes", async () => {
    const response = await patchTemplate(
      new Request("http://localhost/api/v1/quotation-templates/cc", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ code: "cc" }) }
    )

    expect(response.status).toBe(400)
  })

  it("returns 404 for missing template", async () => {
    apiAuthMocks.withApiTenant.mockImplementation(async () => null)

    const response = await getTemplateByCode(
      new Request("http://localhost/api/v1/quotation-templates/missing"),
      { params: Promise.resolve({ code: "missing" }) }
    )

    expect(response.status).toBe(404)
  })

  it("creates missing tenant settings when assigning a default", async () => {
    const updateReturning = vi.fn(async () => [])
    const insertReturning = vi.fn(async () => [{ quotationTemplateCode: "cc" }])
    const onConflictDoUpdate = vi.fn(() => ({ returning: insertReturning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: updateReturning })),
        })),
      })),
      insert: vi.fn(() => ({ values })),
    }
    const { updateTenantQuotationTemplateCode } = await vi.importActual<
      typeof import("@/lib/quotation-template-api")
    >("@/lib/quotation-template-api")

    await expect(updateTenantQuotationTemplateCode(tx as never, "tenant-1", "cc")).resolves.toBe("cc")
    expect(tx.insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "tenant-1", quotationTemplateCode: "cc" })
    )
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it("locks the tenant template while revalidating a default candidate", async () => {
    const lock = vi.fn(async () => [{ code: "cc", isActive: true }])
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({ for: lock })),
          })),
        })),
      })),
    }
    const { getQuotationTemplateByCodeForUpdate } = await vi.importActual<
      typeof import("@/lib/quotation-template-api")
    >("@/lib/quotation-template-api")

    await expect(
      getQuotationTemplateByCodeForUpdate(tx as never, "tenant-1", "cc")
    ).resolves.toMatchObject({ code: "cc", isActive: true })
    expect(lock).toHaveBeenCalledWith("update")
  })

  it("clears matching tenant default when a template is deactivated", async () => {
    const tx = makeTx()
    apiAuthMocks.withApiTenant.mockImplementation(async (_ctx, _permission, fn) => {
      return fn(tx as never, _ctx as never)
    })

    const response = await patchTemplate(
      new Request("http://localhost/api/v1/quotation-templates/cc", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ code: "cc" }) }
    )

    expect(response.status).toBe(200)
    expect(tx.update).toHaveBeenCalledTimes(2)
  })

  it("clears matching tenant default when a template is deleted", async () => {
    const tx = makeTx()
    apiAuthMocks.withApiTenant.mockImplementation(async (_ctx, _permission, fn) => {
      return fn(tx as never, _ctx as never)
    })

    const response = await deleteTemplate(
      new Request("http://localhost/api/v1/quotation-templates/cc", { method: "DELETE" }),
      { params: Promise.resolve({ code: "cc" }) }
    )

    expect(response.status).toBe(200)
    expect(tx.update).toHaveBeenCalledTimes(2)
  })
})

describe("account template assignment API route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiAuthMocks.getApiContext.mockResolvedValue({ tenantId: "tenant-1", can: () => true, memberId: "member-1" })
    accessScopeMocks.visibleMemberIds.mockResolvedValue(null)
    accessScopeMocks.ownsOrManages.mockReturnValue(true)
    accessScopeMocks.canManageAllRecords.mockReturnValue(true)
    apiAuthMocks.withApiTenant.mockImplementation(async (_ctx, _permission, fn) => {
      return fn(
        {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() => ([{ id: "acct-1", ownerMemberId: null, quotationTemplateCode: null }])),
              })),
            })),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(() => [{ id: "acct-1", quotationTemplateCode: "cc" }]),
              })),
            })),
          })),
        } as never,
        _ctx as never
      )
    })
  })

  it("reads current account template code", async () => {
    const response = await getAccountTemplate(
      new Request("http://localhost/api/v1/accounts/acct-1/quotation-template-code"),
      { params: Promise.resolve({ id: "acct-1" }) }
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ data: { accountId: "acct-1" } })
  })

  it("rejects inactive assigned template", async () => {
    templateApiMocks.getQuotationTemplateByCode.mockResolvedValue({ isActive: false } as never)

    const response = await patchAccountTemplate(
      new Request("http://localhost/api/v1/accounts/acct-1/quotation-template-code", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotationTemplateCode: "cc" }),
      }),
      { params: Promise.resolve({ id: "acct-1" }) }
    )

    const payload = await response.json()
    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ error: { code: "validation" } })
    expect(apiAuthMocks.withApiTenant).toHaveBeenCalledTimes(1)
  })
})

describe("tenant quotation template default API route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiAuthMocks.getApiContext.mockResolvedValue({ tenantId: "tenant-1", can: () => true })
    apiAuthMocks.withApiTenant.mockImplementation(async (_ctx, _permission, fn) => {
      return fn({} as never, _ctx as never)
    })
    templateApiMocks.getTenantQuotationTemplateCode.mockResolvedValue(null)
    templateApiMocks.updateTenantQuotationTemplateCode.mockImplementation(
      async (_tx, _tenantId, code) => code
    )
    templateApiMocks.getQuotationTemplateByCode.mockResolvedValue({ code: "cc", isActive: true })
    templateApiMocks.getQuotationTemplateByCodeForUpdate.mockResolvedValue({
      code: "cc",
      isActive: true,
    })
  })

  it("reads the tenant quotation template default", async () => {
    templateApiMocks.getTenantQuotationTemplateCode.mockResolvedValue("cc")

    const response = await getTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { quotationTemplateCode: "cc" } })
  })

  it("sets an active normalized tenant template default", async () => {
    const response = await patchTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotationTemplateCode: " CC " }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { quotationTemplateCode: "cc" } })
  })

  it("rejects default assignment when locked revalidation sees a concurrent deactivation", async () => {
    templateApiMocks.getQuotationTemplateByCodeForUpdate.mockResolvedValue({
      code: "cc",
      isActive: false,
    })

    const response = await patchTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotationTemplateCode: "cc" }),
      })
    )

    expect(response.status).toBe(400)
    expect(templateApiMocks.updateTenantQuotationTemplateCode).not.toHaveBeenCalled()
  })

  it("clears the tenant template default", async () => {
    const response = await patchTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotationTemplateCode: null }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { quotationTemplateCode: null } })
    expect(templateApiMocks.getQuotationTemplateByCode).not.toHaveBeenCalled()
  })

  it.each([
    ["unknown", null],
    ["inactive", { code: "cc", isActive: false }],
  ])("rejects an %s tenant template default", async (_kind, template) => {
    templateApiMocks.getQuotationTemplateByCodeForUpdate.mockResolvedValue(template)

    const response = await patchTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quotationTemplateCode: "cc" }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation" },
    })
  })

  it("returns only default belonging to authenticated tenant", async () => {
    const defaults = new Map([
      ["tenant-1", "cc"],
      ["tenant-2", "qar"],
    ])
    apiAuthMocks.getApiContext.mockResolvedValue({ tenantId: "tenant-2", can: () => true })
    templateApiMocks.getTenantQuotationTemplateCode.mockImplementation(
      async (_tx, tenantId) => defaults.get(tenantId) ?? null
    )

    const response = await getTenantDefault(
      new Request("http://localhost/api/v1/quotation-templates/default")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { quotationTemplateCode: "qar" } })
  })
})
