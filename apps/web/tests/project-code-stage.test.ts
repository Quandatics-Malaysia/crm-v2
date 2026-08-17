import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerContext } from "@/lib/server-context"
import type { Tx } from "@/db"
import { opportunities, projects } from "@/db/schema"

const nextProjectCode = vi.hoisted(() => vi.fn(async () => "2026-QM-ACME-WEB-001"))
const stageRunInTenant = vi.hoisted(() => vi.fn())

vi.mock("@/server/services/numbering", () => ({ nextProjectCode }))
vi.mock("@/db", () => ({ runInTenant: stageRunInTenant }))
vi.mock("@/server/services/value", () => ({
  opportunityNetValue: vi.fn(async () => ({ value: "0" })),
}))
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({ finance: false })),
}))
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => undefined) }))
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => undefined) }))

import {
  createOpportunityContainer,
  ensureOpportunityProjectCode,
} from "@/server/services/opportunity-container"
import {
  reopenOpportunity,
  requestStageAdvance,
  shouldAllocateOpportunityProjectCode,
} from "@/server/services/stage"

function query<T>(value: T) {
  const promise = Promise.resolve(value)
  const q: Record<string, unknown> = {
    from: vi.fn(() => q),
    where: vi.fn(() => q),
    limit: vi.fn(() => q),
    for: vi.fn(() => q),
    values: vi.fn(() => q),
    set: vi.fn(() => q),
    returning: vi.fn(() => q),
    then: promise.then.bind(promise),
  }
  return q
}

function txWithSelects(values: unknown[], updateResult: unknown[] = []) {
  const queue = [...values]
  const tx = {
    select: vi.fn(() => query(queue.shift() ?? [])),
    update: vi.fn(() => query(updateResult)),
    insert: vi.fn(() => query([])),
  } as unknown as Tx
  return tx
}

const ctx = {
  tenantId: "tenant-1",
  memberId: "member-1",
  isSuperadmin: true,
  can: () => true,
} as ServerContext

function stageTransactionFixture() {
  const stages = [
    {
      id: "stage-0e",
      pipelineId: "pipeline-1",
      code: "0e",
      name: "0E",
      kind: "OPEN",
      sortOrder: 0,
      probability: "0",
      requiredFields: [],
      requiresApprovalToEnter: false,
    },
    {
      id: "stage-4a",
      pipelineId: "pipeline-1",
      code: "4a",
      name: "4A",
      kind: "OPEN",
      sortOrder: 4,
      probability: "50",
      requiredFields: [],
      requiresApprovalToEnter: false,
    },
    {
      id: "stage-kiv",
      pipelineId: "pipeline-1",
      code: "kiv",
      name: "KIV",
      kind: "PARKED",
      sortOrder: 99,
      probability: "0",
      requiredFields: [],
      requiresApprovalToEnter: false,
    },
  ]
  const state = {
    opportunity: {
      id: "opp-1",
      tenantId: ctx.tenantId,
      accountId: "account-1",
      opportunityYear: 2026,
      projectNatureCode: "WEB",
      projectCode: null as string | null,
      vision: null,
      pain: null,
      ownerContactId: null,
      ownerBudgetLimit: null,
      estimatedBudget: null,
      estimatedCloseDate: null,
      powerSponsorContactId: null,
      powerSponsorBudgetLimit: null,
      value: null,
    },
    funnel: {
      id: "funnel-1",
      tenantId: ctx.tenantId,
      opportunityId: "opp-1",
      pipelineId: "pipeline-1",
      accountId: "account-1",
      ownerMemberId: "member-1",
      currentStageId: "stage-0e",
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
    },
    account: { code: "ACME" },
    committedUpdates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    committedInsertTables: [] as unknown[],
    committedInsertRows: [] as unknown[],
    lockCount: 0,
    failStageHistoryOnce: false,
  }

  function query<T>(value: T, onForUpdate?: () => void, error?: Error) {
    const promise = error ? Promise.reject(error) : Promise.resolve(value)
    const q: Record<string, unknown> = {
      from: vi.fn(() => q),
      where: vi.fn(() => q),
      limit: vi.fn(() => q),
      for: vi.fn(() => {
        onForUpdate?.()
        return q
      }),
      values: vi.fn(() => q),
      set: vi.fn(() => q),
      returning: vi.fn(() => q),
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    }
    return q
  }

  function snapshot() {
    return {
      opportunity: { ...state.opportunity },
      funnel: { ...state.funnel },
      committedUpdates: [...state.committedUpdates],
      committedInsertTables: [...state.committedInsertTables],
      committedInsertRows: [...state.committedInsertRows],
    }
  }

  function restore(saved: ReturnType<typeof snapshot>) {
    Object.assign(state.opportunity, saved.opportunity)
    Object.assign(state.funnel, saved.funnel)
    state.committedUpdates = saved.committedUpdates
    state.committedInsertTables = saved.committedInsertTables
    state.committedInsertRows = saved.committedInsertRows
  }

  function makeTx() {
    const writes = {
      updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
      insertTables: [] as unknown[],
      insertRows: [] as unknown[],
    }
    const selects = state.funnel.currentStageId === "stage-kiv"
      ? [[state.funnel], [stages[2]], [stages[0]]]
      : [
          [state.funnel],
          [state.opportunity],
          stages,
          [{ customFunnelFields: [] }],
          [state.opportunity],
          [state.account],
          [],
        ]
    const tx = {
      select: vi.fn(() => query(selects.shift() ?? [], () => state.lockCount++)),
      update: vi.fn((table: unknown) => {
        const q = query([])
        q.set = vi.fn((values: Record<string, unknown>) => {
          writes.updates.push({ table, values })
          if (values.currentStageId) Object.assign(state.funnel, values)
          if (values.projectCode !== undefined) Object.assign(state.opportunity, values)
          return q
        })
        q.returning = vi.fn(() =>
          query(state.opportunity.projectCode ? [{ projectCode: state.opportunity.projectCode }] : [])
        )
        return q
      }),
      insert: vi.fn((table: unknown) => {
        writes.insertTables.push(table)
        const shouldFail = state.failStageHistoryOnce
        state.failStageHistoryOnce = false
        const q = query([], undefined, shouldFail ? new Error("simulated stage transaction rollback") : undefined)
        q.values = vi.fn((values: unknown) => {
          writes.insertRows.push(values)
          return q
        })
        return q
      }),
    } as unknown as Tx
    return { tx, writes }
  }

  stageRunInTenant.mockImplementation(async (_tenantId: string, work: (tx: Tx) => Promise<unknown>) => {
    const saved = snapshot()
    const transaction = makeTx()
    const result = await work(transaction.tx).catch((error) => {
      restore(saved)
      throw error
    })
    state.committedUpdates.push(...transaction.writes.updates)
    state.committedInsertTables.push(...transaction.writes.insertTables)
    state.committedInsertRows.push(...transaction.writes.insertRows)
    return result
  })

  stageRunInTenant.mockClear()

  return { stages, state }
}

describe("Opportunity project-code timing", () => {
  beforeEach(() => {
    nextProjectCode.mockClear()
  })

  it("creates the system name from the code and leaves projectCode null", async () => {
    const tx = txWithSelects([
      [{ max: 0 }],
      [{ organizationCode: " qm-01 " }],
    ])
    const insert = query([{ id: "opp-1", accountId: "account-1" }])
    ;(tx.insert as ReturnType<typeof vi.fn>).mockReturnValue(insert)

    const created = await createOpportunityContainer(tx, ctx, {
      accountId: "account-1",
      ownerMemberId: "member-1",
      name: "Human-entered name must be ignored",
      year: 2026,
      currency: "MYR",
    })

    expect(created.code).toBe("QM01OPP-2026-0001")
    expect((insert.values as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      code: "QM01OPP-2026-0001",
      name: "QM01OPP-2026-0001",
      projectCode: null,
    })
    expect(nextProjectCode).not.toHaveBeenCalled()
  })

  it("allocates only for 4A, and not for earlier or rollback stages", () => {
    expect(shouldAllocateOpportunityProjectCode("4a")).toBe(true)
    for (const code of ["0e", "1d", "2c", "3b", "won", "lost", "kiv"]) {
      expect(shouldAllocateOpportunityProjectCode(code)).toBe(false)
    }
  })

  it("allocates on first 4A entry and preserves the value on re-entry", async () => {
    const firstTx = txWithSelects(
      [[{ projectCode: null, accountId: "account-1", opportunityYear: 2026, projectNatureCode: "WEB" }], [{ code: "ACME" }]],
      [{ projectCode: "2026-QM-ACME-WEB-001" }]
    )
    await expect(
      ensureOpportunityProjectCode(firstTx, "opp-1", ctx)
    ).resolves.toBe("2026-QM-ACME-WEB-001")
    expect(nextProjectCode).toHaveBeenCalledOnce()

    const secondTx = txWithSelects([
      [{ projectCode: "2026-QM-ACME-WEB-001", accountId: "account-1", opportunityYear: 2026, projectNatureCode: "WEB" }],
    ])
    await expect(
      ensureOpportunityProjectCode(secondTx, "opp-1", ctx)
    ).resolves.toBe("2026-QM-ACME-WEB-001")
    expect(nextProjectCode).toHaveBeenCalledOnce()
  })

  it("runs the production stage transaction through 4A, rolls back safely, and preserves one assignment on re-entry", async () => {
    const { state } = stageTransactionFixture()
    state.failStageHistoryOnce = true

    await expect(
      requestStageAdvance(ctx, { funnelId: "funnel-1", targetStageId: "stage-4a" })
    ).rejects.toThrow("simulated stage transaction rollback")
    expect(state.funnel.currentStageId).toBe("stage-0e")
    expect(state.opportunity.projectCode).toBeNull()

    await expect(
      requestStageAdvance(ctx, { funnelId: "funnel-1", targetStageId: "stage-4a" })
    ).resolves.toEqual({ moved: true })
    expect(state.funnel.currentStageId).toBe("stage-4a")
    expect(state.opportunity.projectCode).toBe("2026-QM-ACME-WEB-001")
    expect(state.lockCount).toBe(2)
    expect(state.committedInsertRows).toHaveLength(1)
    expect(state.committedInsertTables).not.toContain(projects)
    expect(state.committedUpdates.filter(({ table, values }) => {
      return table === opportunities && "projectCode" in values
    })).toHaveLength(1)

    state.funnel.currentStageId = "stage-kiv"
    state.funnel.status = "on_hold"
    await expect(
      reopenOpportunity(ctx, {
        funnelId: "funnel-1",
        targetStageId: "stage-0e",
        reason: "Re-open for a fresh qualification pass",
      })
    ).resolves.toBeUndefined()

    await expect(
      requestStageAdvance(ctx, { funnelId: "funnel-1", targetStageId: "stage-4a" })
    ).resolves.toEqual({ moved: true })
    expect(state.opportunity.projectCode).toBe("2026-QM-ACME-WEB-001")
    expect(nextProjectCode).toHaveBeenCalledTimes(2)
    expect(stageRunInTenant).toHaveBeenCalledTimes(4)
    expect(stageRunInTenant.mock.calls.every(([tenantId]) => tenantId === ctx.tenantId)).toBe(true)
    expect(state.committedInsertTables).not.toContain(projects)
    expect(state.committedUpdates.filter(({ table }) => table === projects)).toHaveLength(0)
    expect(state.committedUpdates.filter(({ table, values }) => {
      return table === opportunities && "projectCode" in values
    })).toHaveLength(1)
  })
})
