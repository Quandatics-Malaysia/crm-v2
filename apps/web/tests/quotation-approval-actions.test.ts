import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  withTenant: vi.fn(),
  runAction: vi.fn(async (work: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await work() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }),
  visibleMemberIds: vi.fn(async () => ["member-1"]),
  canManageAllRecords: vi.fn(() => false),
  ownsOrManages: vi.fn(() => true),
  writeAudit: vi.fn(),
  revalidatePath: vi.fn(),
  winOpportunity: vi.fn(),
}))

vi.mock("@/lib/actions", () => ({ withTenant: mocks.withTenant }))
vi.mock("@/lib/action-result", () => ({ runAction: mocks.runAction }))
vi.mock("@/lib/access-scope", () => ({
  visibleMemberIds: mocks.visibleMemberIds,
  canManageAllRecords: mocks.canManageAllRecords,
  ownsOrManages: mocks.ownsOrManages,
  ownerScope: vi.fn(),
}))
vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }))
vi.mock("@/server/services/stage", () => ({ winOpportunity: mocks.winOpportunity }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn() }))
vi.mock("@/server/services/value", () => ({
  syncOpportunityAmount: vi.fn(),
  quoteNet: vi.fn(),
}))
vi.mock("@/server/services/quote-sync", () => ({ syncFunnelProductsFromQuote: vi.fn() }))
vi.mock("@/app/(app)/payment-milestones/actions", () => ({
  seedDefaultFunnelMilestone: vi.fn(),
}))
vi.mock("@/lib/modules.server", () => ({ getEntitledModuleMap: vi.fn(async () => ({ projects: false })) }))
vi.mock("@/server/services/numbering", () => ({ nextQuoteNumber: vi.fn() }))

import {
  acceptQuotation,
  approveQuotation,
  rejectQuotation,
  returnApprovedQuotationToDraft,
  sendQuotation,
  submitQuotationForApproval,
  rejectCustomerQuotation,
} from "@/app/(app)/quotations/actions"

type Chain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  for: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
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
  q.for = vi.fn(() => q)
  q.set = vi.fn((payload: unknown) => {
    updates.push(payload)
    return q
  })
  q.insert = vi.fn(() => q)
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
    update: vi.fn(() => chain([], updates)),
    insert: vi.fn(() => chain([], updates)),
  }
  return { tx, updates }
}

const ctx = {
  tenantId: "tenant-1",
  memberId: "member-1",
  userId: "user-1",
}

describe("quotation approval actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withTenant.mockImplementation(async (_permission, work) => work(currentTx, ctx))
  })

  let currentTx: ReturnType<typeof txWithSelects>["tx"]

  it("submits Draft for approval with row locking and audit", async () => {
    const fixture = txWithSelects([
      [{ id: "quote-1", funnelId: "funnel-1", status: "draft" }],
      [{ ownerMemberId: "member-1" }],
      [{ id: "quote-1", status: "pending_approval" }],
    ])
    currentTx = fixture.tx

    const result = await submitQuotationForApproval("quote-1")

    expect(result).toMatchObject({ ok: true })
    expect(fixture.tx.select.mock.results[0]?.value.for).toHaveBeenCalledWith("update")
    expect(fixture.updates[0]).toMatchObject({
      status: "pending_approval",
      rejectionReason: null,
    })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      fixture.tx,
      ctx,
      expect.objectContaining({ action: "quotation.submitted_for_approval" })
    )
  })

  it("rejects approval and records reason while returning quote to Draft", async () => {
    const fixture = txWithSelects([
      [{ id: "quote-1", funnelId: "funnel-1", status: "pending_approval" }],
      [{ ownerMemberId: "member-1" }],
    ])
    currentTx = fixture.tx

    const result = await rejectQuotation("quote-1", "Pricing needs correction")

    expect(result).toMatchObject({ ok: true })
    expect(fixture.updates[0]).toMatchObject({
      status: "draft",
      rejectionReason: "Pricing needs correction",
      approverMemberId: null,
      approvedAt: null,
    })
  })

  it("approves Pending Approval with approver metadata and audit", async () => {
    const fixture = txWithSelects([
      [{ id: "quote-1", funnelId: "funnel-1", status: "pending_approval" }],
      [{ ownerMemberId: "member-1" }],
    ])
    currentTx = fixture.tx

    const result = await approveQuotation("quote-1")

    expect(result).toMatchObject({ ok: true })
    expect(fixture.updates[0]).toMatchObject({
      status: "approved",
      approverMemberId: "member-1",
      rejectionReason: null,
    })
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      fixture.tx,
      ctx,
      expect.objectContaining({ action: "quotation.approved" })
    )
  })

  it("requires explicit reset before editing an Approved quotation", async () => {
    const fixture = txWithSelects([
      [{ id: "quote-1", funnelId: "funnel-1", status: "approved" }],
      [{ ownerMemberId: "member-1" }],
    ])
    currentTx = fixture.tx

    const result = await returnApprovedQuotationToDraft("quote-1")

    expect(result).toMatchObject({ ok: true })
    expect(fixture.updates[0]).toMatchObject({
      status: "draft",
      approverMemberId: null,
      approvedAt: null,
      rejectionReason: null,
    })
  })

  it("does not send Draft even when sender has send permission", async () => {
    const fixture = txWithSelects([
      [{ id: "quote-1", funnelId: "funnel-1", status: "draft" }],
      [{ ownerMemberId: "member-1", status: "open" }],
    ])
    currentTx = fixture.tx

    const result = await sendQuotation("quote-1")

    expect(result).toEqual({
      ok: false,
      error: "Quotation must be approved before it can be sent",
    })
  })

  it("accepts Sent without invoking Funnel win automation", async () => {
    const fixture = txWithSelects([
      [{
        id: "quote-1",
        funnelId: "funnel-1",
        status: "sent",
        validUntil: null,
        isPrimary: false,
        quoteNumber: "Q-1",
        total: "100.00",
      }],
      [{ ownerMemberId: "member-1", status: "open", accountId: "account-1" }],
      [],
      [{ id: "quote-1" }],
    ])
    currentTx = fixture.tx

    const result = await acceptQuotation("quote-1")

    expect(result).toMatchObject({ ok: true })
    expect(mocks.winOpportunity).not.toHaveBeenCalled()
  })

  it("allows customer rejection only from Sent", async () => {
    const fixture = txWithSelects([
      [{
        id: "quote-1",
        funnelId: "funnel-1",
        status: "sent",
        isPrimary: false,
      }],
      [{ ownerMemberId: "member-1" }],
    ])
    currentTx = fixture.tx

    const result = await rejectCustomerQuotation("quote-1")

    expect(result).toMatchObject({ ok: true })
    expect(fixture.updates[0]).toMatchObject({ status: "rejected" })
  })
})
