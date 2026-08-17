import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Tx } from "@/db"
import type { ServerContext } from "@/lib/server-context"

const mocks = vi.hoisted(() => ({
  withTenant: vi.fn(),
  runAction: vi.fn(async (work: () => Promise<unknown>) => ({
    ok: true,
    data: await work(),
  })),
  updateFunnelPpvvc: vi.fn(),
  updateOpportunityPpvvc: vi.fn(),
  recordPpvvcSyncChanges: vi.fn(),
  getEntitledModuleMap: vi.fn(async () => ({ finance: false })),
  tenantCurrencyForRecord: vi.fn(async (_tx: Tx, _tenantId: string, _input: unknown, current: string) => current),
  visibleMemberIds: vi.fn(async () => []),
  canManageAllRecords: vi.fn(() => true),
  ownsOrManages: vi.fn(() => false),
  recomputeOpportunityTotal: vi.fn(),
  recordChanges: vi.fn(),
}))

vi.mock("@/lib/actions", () => ({
  withTenant: mocks.withTenant,
  requireContext: vi.fn(),
  assertCan: vi.fn(),
}))
vi.mock("@/lib/action-result", () => ({ runAction: mocks.runAction }))
vi.mock("@/server/services/ppvvc", () => ({
  updateFunnelPpvvc: mocks.updateFunnelPpvvc,
  updateOpportunityPpvvc: mocks.updateOpportunityPpvvc,
  recordPpvvcSyncChanges: mocks.recordPpvvcSyncChanges,
}))
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: mocks.getEntitledModuleMap,
}))
vi.mock("@/lib/access-scope", () => ({
  visibleMemberIds: mocks.visibleMemberIds,
  canManageAllRecords: mocks.canManageAllRecords,
  ownsOrManages: mocks.ownsOrManages,
  ownerScope: vi.fn(),
}))
vi.mock("@/server/services/tenant-currency", () => ({
  tenantCurrencyForRecord: mocks.tenantCurrencyForRecord,
  assertCurrencyLock: vi.fn(),
}))
vi.mock("@/server/services/opportunity-container", () => ({
  recomputeOpportunityTotal: mocks.recomputeOpportunityTotal,
  createOpportunityContainer: vi.fn(),
  pickNature: vi.fn(),
}))
vi.mock("@/server/services/changes/record", () => ({ recordChanges: mocks.recordChanges }))
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn() }))
vi.mock("@/server/services/stage", () => ({
  requestStageAdvance: vi.fn(),
  reopenOpportunity: vi.fn(),
}))
vi.mock("@/lib/api-readers", () => ({
  funnelsList: vi.fn(),
  funnelsGet: vi.fn(),
  opportunitiesList: vi.fn(),
  opportunitiesGet: vi.fn(),
  loadPartiesByOpportunity: vi.fn(async () => new Map()),
}))
vi.mock("@/db", () => ({
  db: { select: vi.fn() },
  runInTenant: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateOpportunity as updateFunnel } from "@/app/(app)/funnel/actions"
import { updateOpportunityContainer } from "@/app/(app)/opportunities/actions"

const ctx = {
  tenantId: "tenant-1",
  userId: "user-1",
  memberId: "member-1",
  isSuperadmin: true,
  permissions: new Set<string>(),
  can: () => true,
} as unknown as ServerContext

type Update = { table: unknown; values: Record<string, unknown> }

function chain(value: unknown, updates: Update[]): Record<string, unknown> {
  const promise = Promise.resolve(value)
  const q: Record<string, unknown> = {
    from: vi.fn(() => q),
    where: vi.fn(() => q),
    limit: vi.fn(() => q),
    orderBy: vi.fn(() => q),
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push({ table: undefined, values })
      return q
    }),
    then: promise.then.bind(promise),
  }
  return q
}

function txFixture(selects: unknown[]) {
  const queue = [...selects]
  const updates: Update[] = []
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [], updates)),
    update: vi.fn((table: unknown) => {
      const q = chain([], updates)
      q.set = vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values })
        return q
      })
      return q
    }),
  } as unknown as Tx
  return { tx, updates }
}

const funnel = {
  id: "funnel-1",
  tenantId: ctx.tenantId,
  opportunityId: "opportunity-1",
  ownerMemberId: ctx.memberId,
  name: "Existing Funnel",
  accountId: "account-1",
  primaryPersonId: null,
  primaryQuotationId: null,
  currency: "MYR",
  amount: null,
  estimatedAmount: null,
  isIntercompany: false,
  customFields: null,
  projectNatureCode: "WEB",
  projectNatures: ["WEB"],
  expectedCloseDate: null,
  projectYear: 2026,
  procurementStage: null,
  negotiationDone: false,
  negotiationDate: null,
  expectedInvoiceMonth: null,
  expectedInvoiceYear: null,
  description: "Keep funnel description",
  pain: "Old pain",
  power: "Old power",
  vision: "Old vision",
  value: "Old value",
  control: "Old control",
}

const opportunity = {
  id: "opportunity-1",
  tenantId: ctx.tenantId,
  ownerMemberId: ctx.memberId,
  projectNatureCode: "WEB",
  projectNatures: ["WEB"],
  description: "Keep opportunity description",
  ownerContactId: null,
  ownerBudgetLimit: null,
  powerSponsorContactId: null,
  powerSponsorBudgetLimit: null,
  estimatedBudget: null,
  estimatedCloseDate: null,
  isRenewal: false,
  showDashboards: true,
  assignedPresales: null,
  competitor: null,
  pain: "Old pain",
  power: "Old power",
  vision: "Old vision",
  value: "Old value",
  control: "Old control",
}

describe("PPVVC action payload seams", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Funnel action submits only changed PPVVC keys and leaves untouched fields to the sync service", async () => {
    const { tx, updates } = txFixture([[funnel], [{ customFunnelFields: [] }]])
    mocks.withTenant.mockImplementation(async (_permission, work) => work(tx, ctx))
    mocks.updateFunnelPpvvc.mockResolvedValue({
      opportunityId: funnel.opportunityId,
      actorId: ctx.userId,
      before: { pain: "Old pain" },
      after: { pain: "New pain" },
      updatedChildIds: [funnel.id],
      updatedChildren: [],
    })

    const result = await updateFunnel(funnel.id, {
      pain: "  New pain  ",
      power: undefined,
      vision: undefined,
      value: undefined,
      control: undefined,
      description: undefined,
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(mocks.updateFunnelPpvvc).toHaveBeenCalledWith(tx, {
      funnelId: funnel.id,
      tenantId: ctx.tenantId,
      values: { pain: "New pain" },
      actorId: ctx.userId,
    })
    const persistedFunnelUpdate = updates.at(-1)?.values
    expect(persistedFunnelUpdate).toMatchObject({
      description: funnel.description,
      projectNatureCode: funnel.projectNatureCode,
    })
    expect(Object.keys(persistedFunnelUpdate ?? {})).not.toEqual(
      expect.arrayContaining(["pain", "power", "vision", "value", "control"])
    )
  })

  it("Opportunity action submits only changed PPVVC keys and leaves untouched fields to the sync service", async () => {
    const { tx, updates } = txFixture([[opportunity]])
    mocks.withTenant.mockImplementation(async (_permission, work) => work(tx, ctx))
    mocks.updateOpportunityPpvvc.mockResolvedValue({
      opportunityId: opportunity.id,
      actorId: ctx.userId,
      before: { power: "Old power" },
      after: { power: "New power" },
      updatedChildIds: [],
      updatedChildren: [],
    })

    const result = await updateOpportunityContainer(opportunity.id, {
      pain: undefined,
      power: " New power ",
      vision: undefined,
      value: undefined,
      control: undefined,
      description: undefined,
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(mocks.updateOpportunityPpvvc).toHaveBeenCalledWith(tx, {
      opportunityId: opportunity.id,
      tenantId: ctx.tenantId,
      values: { power: "New power" },
      actorId: ctx.userId,
    })
    const persistedOpportunityUpdate = updates.at(-2)?.values
    expect(persistedOpportunityUpdate).toMatchObject({
      description: opportunity.description,
      projectNatureCode: opportunity.projectNatureCode,
    })
    expect(Object.keys(persistedOpportunityUpdate ?? {})).not.toEqual(
      expect.arrayContaining(["pain", "power", "vision", "value", "control"])
    )
  })
})
