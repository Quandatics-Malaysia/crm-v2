import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerContext } from "@/lib/server-context"

const runInTenant = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ runInTenant }))
vi.mock("@/server/services/numbering", () => ({ nextProjectCode: vi.fn() }))
vi.mock("@/server/services/value", () => ({
  opportunityNetValue: vi.fn(async () => ({ value: "0" })),
}))
vi.mock("@/server/services/opportunity-container", () => ({
  ensureOpportunityProjectCode: vi.fn(),
  recomputeOpportunityTotal: vi.fn(),
}))
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({ finance: false })),
}))
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => undefined) }))
vi.mock("@/server/services/activity", () => ({
  logActivity: vi.fn(async () => undefined),
}))

import {
  decideApproval,
  requestStageAdvance,
} from "@/server/services/stage"

type Query = Record<string, unknown>

function query(result: unknown[], onForUpdate?: () => void): Query {
  const q: Query = {}
  q.from = vi.fn(() => q)
  q.where = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.for = vi.fn(() => {
    onForUpdate?.()
    return q
  })
  q.set = vi.fn(() => q)
  q.values = vi.fn(() => q)
  q.returning = vi.fn(() => q)
  q.then = Promise.resolve(result).then.bind(Promise.resolve(result))
  q.catch = Promise.resolve(result).catch.bind(Promise.resolve(result))
  return q
}

function makeTx(selectResults: unknown[][], updateResults: unknown[][] = []) {
  const selects = [...selectResults]
  const updates = [...updateResults]
  const updateCalls: Array<{ table: unknown; values: unknown }> = []
  const tx = {
    select: vi.fn(() => query(selects.shift() ?? [])),
    update: vi.fn((table: unknown) => {
      const q = query(updates.shift() ?? [])
      q.set = vi.fn((values: unknown) => {
        updateCalls.push({ table, values })
        return q
      })
      return q
    }),
    insert: vi.fn(() => query([])),
  }
  return { tx, updateCalls }
}

const ctx = {
  tenantId: "tenant-1",
  memberId: "member-1",
  isSuperadmin: true,
  can: () => true,
} as unknown as ServerContext

const baseFunnel = {
  id: "funnel-1",
  tenantId: "tenant-1",
  opportunityId: "opportunity-1",
  pipelineId: "pipeline-1",
  accountId: "account-1",
  currentStageId: "stage-2",
  status: "open",
  amount: null,
  estimatedAmount: null,
  expectedCloseDate: null,
  primaryPersonId: null,
  projectNatures: [],
  primaryQuotationId: null,
  customFields: {},
  procurementStage: null,
  negotiationDone: false,
  negotiationDate: null,
  expectedInvoiceMonth: null,
  expectedInvoiceYear: null,
  awardDate: null,
  closedAt: null,
  actualCloseDate: null,
}

const container = {
  id: "opportunity-1",
  accountId: "account-1",
  vision: null,
  pain: null,
  ownerContactId: null,
  ownerBudgetLimit: null,
  estimatedBudget: null,
  estimatedCloseDate: null,
  value: null,
  powerSponsorContactId: null,
  powerSponsorBudgetLimit: null,
}

const early = {
  id: "stage-1",
  pipelineId: "pipeline-1",
  code: "1d",
  name: "Early",
  kind: "OPEN",
  sortOrder: 1,
  probability: "20",
  requiredFields: ["estimate"],
  requiresApprovalToEnter: false,
}

const later = {
  id: "stage-2",
  pipelineId: "pipeline-1",
  code: "2c",
  name: "Later",
  kind: "OPEN",
  sortOrder: 2,
  probability: "40",
  requiredFields: ["estimate"],
  requiresApprovalToEnter: true,
}

describe("stage approval lifecycle hardening", () => {
  beforeEach(() => {
    runInTenant.mockReset()
  })

  it("cancels pending approvals in same transaction as rollback", async () => {
    const funnel = { ...baseFunnel, currentStageId: later.id }
    const pending = { id: "request-1", targetStageId: "stage-3" }
    const stages = [later, early, { ...later, id: "stage-3", sortOrder: 3, name: "Next" }]
    const { tx, updateCalls } = makeTx(
      [[funnel], [container], stages, [{ customFunnelFields: [] }], [pending]],
      [[pending.id], []]
    )
    runInTenant.mockImplementation(async (_tenantId: string, work: (tx: unknown) => Promise<unknown>) =>
      work(tx)
    )

    await expect(
      requestStageAdvance(ctx, { funnelId: funnel.id, targetStageId: early.id })
    ).resolves.toEqual({ moved: true })

    expect(updateCalls[0].values).toMatchObject({
      status: "cancelled",
      decisionNote: expect.stringContaining("moved back"),
    })
    expect(updateCalls.some(({ values }) =>
      (values as Record<string, unknown>).currentStageId === early.id
    )).toBe(true)
  })

  it("invalidates approval when live entry requirements are no longer satisfied", async () => {
    const request = {
      id: "request-1",
      funnelId: "funnel-1",
      requesterMemberId: "requester-1",
      approverMemberId: "approver-1",
      fromStageId: early.id,
      targetStageId: later.id,
      reason: "Need approval",
      status: "pending",
    }
    const funnel = { ...baseFunnel, currentStageId: early.id }
    const { tx, updateCalls } = makeTx(
      [
        [request],
        [funnel],
        [request],
        [early],
        [later],
        [container],
        [{ customFunnelFields: [] }],
        [early, later],
      ],
      [[{ id: request.id }]]
    )
    runInTenant.mockImplementation(async (_tenantId: string, work: (tx: unknown) => Promise<unknown>) =>
      work(tx)
    )

    await expect(
      decideApproval(
        { ...ctx, isSuperadmin: false, can: () => true } as ServerContext,
        { requestId: request.id, decision: "approved" }
      )
    ).resolves.toMatchObject({ status: "obsolete" })

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].values).toMatchObject({
      status: "rejected",
      decisionNote: expect.stringContaining("Estimated funnel amount"),
    })
  })

  it("treats an approval with a missing source stage as obsolete", async () => {
    const target = { ...later, requiredFields: [] }
    const request = {
      id: "request-null-source",
      funnelId: "funnel-1",
      requesterMemberId: "requester-1",
      approverMemberId: "approver-1",
      fromStageId: null,
      targetStageId: target.id,
      reason: "Need approval",
      status: "pending",
    }
    const funnel = { ...baseFunnel, currentStageId: early.id }
    const { tx, updateCalls } = makeTx(
      [
        [request],
        [funnel],
        [request],
        [early],
        [target],
        [container],
        [{ customFunnelFields: [] }],
        [[early, target]],
      ],
      [[{ id: request.id }]]
    )
    runInTenant.mockImplementation(async (_tenantId: string, work: (tx: unknown) => Promise<unknown>) =>
      work(tx)
    )

    await expect(
      decideApproval(
        { ...ctx, isSuperadmin: false, can: () => true } as ServerContext,
        { requestId: request.id, decision: "approved" }
      )
    ).resolves.toMatchObject({ status: "obsolete" })

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].values).toMatchObject({
      status: "rejected",
      decisionNote: expect.stringContaining("forward transition"),
    })
  })
})
