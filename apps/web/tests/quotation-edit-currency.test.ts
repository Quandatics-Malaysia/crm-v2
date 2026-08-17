import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  withTenant: vi.fn(),
  runAction: vi.fn(async (work: () => Promise<unknown>) => ({
    ok: true,
    data: await work(),
  })),
  visibleMemberIds: vi.fn(async () => []),
  canManageAllRecords: vi.fn(() => true),
  ownsOrManages: vi.fn(() => false),
  writeAudit: vi.fn(),
}))

vi.mock("@/lib/actions", () => ({
  withTenant: mocks.withTenant,
  requireContext: vi.fn(),
}))
vi.mock("@/lib/action-result", () => ({ runAction: mocks.runAction }))
vi.mock("@/lib/access-scope", () => ({
  visibleMemberIds: mocks.visibleMemberIds,
  canManageAllRecords: mocks.canManageAllRecords,
  ownsOrManages: mocks.ownsOrManages,
  ownerScope: vi.fn(),
}))
vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }))
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn() }))
vi.mock("@/server/services/quote-sync", () => ({
  syncFunnelProductsFromQuote: vi.fn(),
}))
vi.mock("@/server/services/value", () => ({
  quoteNet: vi.fn(),
  syncOpportunityAmount: vi.fn(),
}))
vi.mock("@/server/services/stage", () => ({ winOpportunity: vi.fn() }))
vi.mock("@/server/services/numbering", () => ({ nextQuoteNumber: vi.fn() }))
vi.mock("@/app/(app)/payment-milestones/actions", () => ({
  seedDefaultFunnelMilestone: vi.fn(),
}))
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({})),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateQuotation } from "@/app/(app)/quotations/actions"

type Chain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  then: Promise<unknown>["then"]
}

function chain(value: unknown, updates: unknown[]): Chain {
  const promise = Promise.resolve(value)
  const q = {} as Chain
  q.from = vi.fn(() => q)
  q.where = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.set = vi.fn((payload: unknown) => {
    updates.push(payload)
    return q
  })
  q.values = vi.fn(() => q)
  q.returning = vi.fn(() => q)
  q.then = promise.then.bind(promise)
  return q
}

function txWithSelects(values: unknown[]) {
  const queue = [...values]
  const updates: unknown[] = []
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [], updates)),
    update: vi.fn(() => chain([{ id: "quotation-1" }], updates)),
    delete: vi.fn(() => chain([], updates)),
    insert: vi.fn(() => chain([], updates)),
  }
  return { tx, updates }
}

describe("quotation edit currency persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps the draft quotation currency when edit input omits an override", async () => {
    const existing = {
      id: "quotation-1",
      funnelId: "funnel-1",
      status: "draft",
      currency: "USD",
      isPrimary: false,
    }
    const { tx, updates } = txWithSelects([
      [existing],
      [{ ownerMemberId: "member-1", currency: "MYR" }],
      [{ currencies: ["MYR", "USD"], defaultCurrency: "MYR" }],
      [{ taxInclusive: false }],
    ])
    mocks.withTenant.mockImplementation(async (_permission, work) =>
      work(tx, { tenantId: "tenant-1" })
    )

    const result = await updateQuotation("quotation-1", {
      taxSettingId: null,
      validUntil: null,
      notes: null,
      headerDiscount: "0",
      lines: [
        {
          description: "Consulting",
          quantity: "1",
          unitPrice: "100",
          discountAmount: "0",
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(updates[0]).toMatchObject({ currency: "USD" })
  })
})
