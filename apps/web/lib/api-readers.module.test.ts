import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  accounts,
  funnels,
  funnelStageHistory,
  intercompanyDealParties,
  intercompanyDeals,
  member,
  opportunities,
  persons,
  pipelineStages,
  projects,
  quotations,
  stageApprovalRequests,
} from "@/db/schema"
import { createDisabledModuleMap } from "@/lib/module-registry"
import { funnelsGet, funnelsList, personsGet } from "@/lib/api-readers"
import type { Tx } from "@/db"
import type { ServerContext } from "@/lib/server-context"

const moduleState = vi.hoisted(() => ({
  map: {
    projects: false,
    salesOrders: false,
    finance: false,
    forecast: false,
    audit: false,
    advancedRoles: false,
    documentation: false,
  },
}))

vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => moduleState.map),
}))

const ctx = {
  tenantId: "tenant-1",
  memberId: "member-1",
  isSuperadmin: true,
  can: () => true,
} as unknown as ServerContext

function tableTx(entries: Array<[object, unknown[]]>): Tx {
  const queues = new Map(entries.map(([table, values]) => [table, [...values]]))
  return {
    select: vi.fn(() => {
      let value: unknown = []
      const promise = () => Promise.resolve(value)
      const chain: Record<string, unknown> = {
        from: vi.fn((table: object) => {
          value = queues.get(table)?.shift() ?? []
          return chain
        }),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        groupBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        offset: vi.fn(() => chain),
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) =>
          promise().then(resolve, reject),
      }
      return chain
    }),
  } as unknown as Tx
}

describe("module-owned nested API readers", () => {
  beforeEach(() => {
    moduleState.map = createDisabledModuleMap()
  })

  it("does not query or return project rows from a core person detail", async () => {
    const tx = tableTx([
      [persons, [[{ person: { id: "person-1" }, accountName: "Acme", accountOwner: "member-1" }]]],
      [funnels, [[{ id: "funnel-1", name: "Deal" }]]],
      [projects, [[{ id: "project-secret", name: "Secret project" }]]],
    ])

    const detail = await personsGet(tx, ctx, "person-1")

    expect(detail?.projects).toEqual([])
    expect((tx.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it("does not query or return intercompany parties from the funnel list", async () => {
    const tx = tableTx([
      [funnels, [[{ id: "funnel-1", name: "Deal" }], [{ count: 1 }]]],
      [intercompanyDealParties, [[{
        funnelId: "funnel-1",
        partnerEntityId: "partner-secret",
        partnerName: "Secret partner",
        shareType: "percent",
        shareValue: "40",
        currency: "MYR",
        manualFxRate: null,
      }]]],
    ])

    const result = await funnelsList(tx, ctx, { limit: 50, offset: 0 })

    expect(result.rows[0]?.parties).toEqual([])
    expect((tx.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it("does not query or return parties or partner responses from funnel detail", async () => {
    const tx = tableTx([
      [funnels, [[{
        id: "funnel-1",
        accountId: "account-1",
        opportunityId: "opportunity-1",
        ownerMemberId: "member-1",
        currentStageId: "stage-1",
        pipelineId: "pipeline-1",
        primaryPersonId: null,
        primaryQuotationId: null,
        isIntercompany: true,
      }]]],
      [accounts, [[{ name: "Acme" }]]],
      [opportunities, [[{ id: "opportunity-1" }]]],
      [intercompanyDealParties, [[{
        funnelId: "funnel-1",
        partnerEntityId: "partner-secret",
        partnerName: "Secret partner",
        shareType: "percent",
        shareValue: "40",
        currency: "MYR",
        manualFxRate: null,
      }]]],
      [intercompanyDeals, [[{
        partnerEntityId: "partner-secret",
        response: "accepted",
        reason: null,
        respondedAt: new Date("2026-01-01"),
      }]]],
      [member, [[{ name: "Owner" }]]],
      [pipelineStages, [[{ id: "stage-1", name: "Open" }], [{ id: "stage-1", name: "Open" }]]],
      [quotations, [[]]],
      [funnelStageHistory, [[]]],
      [stageApprovalRequests, [[]]],
    ])

    const detail = await funnelsGet(tx, ctx, "funnel-1")

    expect(detail?.parties).toEqual([])
    expect(detail?.partnerResponses).toEqual([])
    expect((tx.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(9)
  })
})
