import { beforeEach, describe, expect, it, vi } from "vitest"

import { createDisabledModuleMap, type ModuleId } from "@/lib/module-registry"
import type { ServerContext } from "@/lib/server-context"
import type { Tx } from "@/db"

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
    withTenant: vi.fn(),
    withModule: vi.fn(),
    requireContext: vi.fn(),
    runInTenant: vi.fn(),
    reserveInvitation: vi.fn(),
    activateMembership: vi.fn(),
    writeAudit: vi.fn(),
  }
})

vi.mock("@/lib/modules.server", () => ({
  ModuleAccessDeniedError: mocks.TestModuleAccessDeniedError,
  getEntitledModuleMap: vi.fn(async () => mocks.map),
  requireEntitledModule: mocks.requireModule,
  withEntitledModule: vi.fn(async (id: ModuleId, work: () => unknown) => {
    await mocks.requireModule(id)
    return work()
  }),
}))

vi.mock("@/lib/actions", () => ({
  withTenant: mocks.withTenant,
  withModule: mocks.withModule,
  requireContext: mocks.requireContext,
  assertCan: vi.fn(),
}))

vi.mock("@/lib/server-context", () => ({
  requireContext: mocks.requireContext,
  getServerContext: mocks.requireContext,
  assertCan: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: { select: vi.fn() },
  runInTenant: mocks.runInTenant,
}))

vi.mock("@/lib/deployment-seats", () => ({
  normalizeSeatEmail: (email: string) => email.trim().toLowerCase(),
  reserveInvitation: mocks.reserveInvitation,
  activateMembership: mocks.activateMembership,
  disableOrRemoveMembership: vi.fn(),
  releaseInvitation: vi.fn(),
}))

vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }))
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn() }))
vi.mock("@/server/services/changes/record", () => ({ recordChanges: vi.fn() }))
vi.mock("@/lib/subscription-licensing", () => ({
  getLicenseStateForTenant: vi.fn(async () => ({
    activeMemberCount: 1,
    isSubscriptionActive: true,
  })),
}))
vi.mock("@/lib/write-access", () => ({
  LICENSE_READ_ONLY: "LICENSE_READ_ONLY",
  LicenseReadOnlyError: class LicenseReadOnlyError extends Error {},
  assertWriteAllowed: vi.fn(async () => undefined),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { db } from "@/db"
import {
  addMember,
  listTeamRoles,
  updateMember,
} from "@/app/(app)/team/actions"
import {
  createProject,
  deleteProject,
} from "@/app/(app)/projects/actions"
import { deleteQuotation } from "@/app/(app)/quotations/actions"
import {
  updateNumbering,
  updateSettings,
  updateInvoiceReminderDays,
} from "@/app/(app)/settings/actions"
import {
  createTax,
  listTaxSettings,
} from "@/app/(app)/settings/billing/tax/actions"

const ctx = {
  tenantId: "tenant-1",
  userId: "user-1",
  memberId: "member-1",
  isSuperadmin: true,
  permissions: new Set<string>(),
  can: () => true,
} as unknown as ServerContext

function chain(
  value: unknown,
  mutations?: { updates: unknown[]; conflictSets: unknown[]; deletes: number }
) {
  const promise = Promise.resolve(value)
  const q: Record<string, unknown> = {
    from: vi.fn(() => q),
    innerJoin: vi.fn(() => q),
    leftJoin: vi.fn(() => q),
    where: vi.fn(() => q),
    orderBy: vi.fn(() => q),
    groupBy: vi.fn(() => q),
    limit: vi.fn(() => q),
    for: vi.fn(() => q),
    set: vi.fn((payload: unknown) => {
      mutations?.updates.push(payload)
      return q
    }),
    values: vi.fn(() => q),
    returning: vi.fn(() => q),
    onConflictDoUpdate: vi.fn((payload: { set?: unknown }) => {
      mutations?.conflictSets.push(payload.set)
      return q
    }),
    then: promise.then.bind(promise),
  }
  return q
}

function txWithSelects(values: unknown[]) {
  const queue = [...values]
  const mutations = {
    updates: [] as unknown[],
    conflictSets: [] as unknown[],
    deletes: 0,
  }
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [], mutations)),
    update: vi.fn(() => chain([{ id: "updated" }], mutations)),
    insert: vi.fn(() => chain([{ id: "inserted" }], mutations)),
    delete: vi.fn(() => {
      mutations.deletes += 1
      return chain([], mutations)
    }),
  } as unknown as Tx
  return { tx, mutations }
}

describe("direct module-owned action entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.map = createDisabledModuleMap()
    mocks.requireModule.mockImplementation(async (id: ModuleId) => {
      if (!mocks.map[id]) throw new mocks.TestModuleAccessDeniedError(id)
    })
    mocks.requireContext.mockResolvedValue(ctx)
    mocks.withModule.mockRejectedValue(new Error("tenant work started"))
    mocks.withTenant.mockRejectedValue(new Error("tenant work started"))
  })

  it("denies an intercompany project before project tenant work", async () => {
    const result = await createProject({
      name: "Inbound delivery",
      accountId: "account-1",
      intercompanyDealId: "deal-1",
    })

    expect(result).toEqual({ ok: false, error: "The finance module is not licensed." })
    expect(mocks.withModule).not.toHaveBeenCalled()
  })

  it("lists only fixed system roles when Advanced Roles is unavailable", async () => {
    const { tx } = txWithSelects([
      [
        { id: "owner", name: "Owner", isSystem: true, defaultTierLevel: 100 },
        { id: "custom", name: "Custom", isSystem: false, defaultTierLevel: 20 },
      ],
      [],
      [],
    ])
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const roles = await listTeamRoles()

    expect(roles.map((role) => role.id)).toEqual(["owner"])
  })

  it("does not reserve a seat with a custom role without Advanced Roles", async () => {
    const { tx } = txWithSelects([
      [{ id: "custom", tier: 20, isSystem: false }],
    ])
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain([]))
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const result = await addMember({ email: "new@example.com", roleId: "custom" })

    expect(result).toEqual({ ok: false, error: "The advancedRoles module is not licensed." })
    expect(mocks.reserveInvitation).not.toHaveBeenCalled()
    expect(mocks.activateMembership).not.toHaveBeenCalled()
  })

  it("does not mutate a member to a custom role without Advanced Roles", async () => {
    const { tx, mutations } = txWithSelects([
      [{ managerMemberId: null }],
      [{ id: "custom", isSystem: false }],
      [],
    ])
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const result = await updateMember("member-2", { roleIds: ["custom"] })

    expect(result).toEqual({ ok: false, error: "The advancedRoles module is not licensed." })
    expect(mutations.deletes).toBe(0)
  })

  it("keeps fixed-role assignment core when Advanced Roles is unavailable", async () => {
    const { tx, mutations } = txWithSelects([
      [{ managerMemberId: null }],
      [{ id: "member", isSystem: true }],
      [],
    ])
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const result = await updateMember("member-2", { roleIds: ["member"] })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(mutations.deletes).toBe(1)
    expect(mocks.requireModule).not.toHaveBeenCalledWith("advancedRoles")
  })

  it("keeps the live-sales-order deletion guard after the module is removed", async () => {
    const { tx, mutations } = txWithSelects([
      [{ ownerMemberId: "member-1" }],
      [{ soCount: 1 }],
      [{ milestoneCount: 0 }],
    ])
    mocks.withModule.mockImplementation(async (_module, _permission, work) => work(tx, ctx))

    const result = await deleteProject("project-1")

    expect(result).toEqual({
      ok: false,
      error: "This project has active sales orders. Reject them before deleting the project.",
    })
    expect(mutations.updates).toHaveLength(0)
  })

  it("keeps the linked-project quotation guard after the module is removed", async () => {
    const { tx, mutations } = txWithSelects([
      [{ funnelId: "funnel-1", status: "draft", oppOwner: "member-1" }],
      [{ id: "project-1" }],
    ])
    mocks.withTenant.mockImplementation(async (_permission, work) => work(tx, ctx))

    const result = await deleteQuotation("quote-1")

    expect(result).toEqual({
      ok: false,
      error: "This quotation can't be deleted because a project references it.",
    })
    expect(mutations.updates).toHaveLength(0)
  })

  it("denies invoice reminder mutation before context or tenant work", async () => {
    const result = await updateInvoiceReminderDays(["7"])

    expect(result).toEqual({ ok: false, error: "The finance module is not licensed." })
    expect(mocks.requireContext).not.toHaveBeenCalled()
    expect(mocks.runInTenant).not.toHaveBeenCalled()
  })

  it("keeps core tax-inclusive quotation settings writable without finance", async () => {
    const { tx, mutations } = txWithSelects([[
      {
        subscriptionPlan: "Starter",
        subscriptionStatus: "active",
        subscriptionSeatLimit: null,
        subscriptionStartsAt: null,
        subscriptionEndsAt: null,
      },
    ]])
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const result = await updateSettings({
      entityName: "Acme",
      defaultCurrency: "MYR",
      fiscalYearStartMonth: 1,
      approvalBypassTier: 40,
      followUpDueDays: 7,
      taxInclusive: true,
      autoWinOnQuoteAccept: true,
      allowPasswordLogin: true,
      entityCode: "ACME",
      defaultCountry: "MY",
      phonePrefix: "+60",
      staleDealDays: null,
      leadFollowUpDays: null,
      autoCompleteProjectOnPaid: true,
      intercoAutoMirror: true,
      documentationModule: true,
    })

    expect(result.ok).toBe(true)
    expect(mutations.conflictSets[0]).toMatchObject({ taxInclusive: true })
    expect(mutations.conflictSets[0]).not.toMatchObject({
      autoCompleteProjectOnPaid: expect.anything(),
      intercoAutoMirror: expect.anything(),
    })
  })

  it("preserves the finance-owned invoice due setting from mixed numbering updates", async () => {
    const { tx, mutations } = txWithSelects([[
      { quoteNextNumber: 1, soNextNumber: 1 },
    ]])
    mocks.runInTenant.mockImplementation(async (_tenantId, work) => work(tx))

    const result = await updateNumbering({
      quoteNextNumber: 2,
      quotePadWidth: 5,
      soNextNumber: 2,
      soPadWidth: 5,
      projectPadWidth: 3,
      quoteValidDays: 30,
      invoiceDueDays: 60,
    })

    expect(result.ok).toBe(true)
    expect(mutations.conflictSets[0]).not.toMatchObject({
      invoiceDueDays: expect.anything(),
    })
  })

  it("keeps core quotation tax settings readable without finance", async () => {
    mocks.withTenant.mockResolvedValue([])

    await expect(listTaxSettings()).resolves.toEqual([])

    expect(mocks.withTenant).toHaveBeenCalledOnce()
    expect(mocks.requireModule).not.toHaveBeenCalledWith("finance")
  })

  it("keeps core quotation tax mutation available without finance", async () => {
    const tax = {
      id: "tax-1",
      name: "SST",
      ratePercent: "8",
      isDefault: true,
      isActive: true,
    }
    mocks.withTenant.mockResolvedValue(tax)

    await expect(createTax({
      name: "SST",
      ratePercent: "8",
      isDefault: true,
      isActive: true,
    })).resolves.toEqual({ ok: true, data: tax })

    expect(mocks.withTenant).toHaveBeenCalledOnce()
    expect(mocks.requireModule).not.toHaveBeenCalledWith("finance")
  })
})
