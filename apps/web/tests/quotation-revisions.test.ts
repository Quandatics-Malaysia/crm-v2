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
  nextQuoteNumber: vi.fn(),
  writeAudit: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/actions", () => ({ withTenant: mocks.withTenant }))
vi.mock("@/lib/action-result", () => ({ runAction: mocks.runAction }))
vi.mock("@/lib/access-scope", () => ({
  visibleMemberIds: mocks.visibleMemberIds,
  canManageAllRecords: mocks.canManageAllRecords,
  ownsOrManages: mocks.ownsOrManages,
  ownerScope: vi.fn(),
}))
vi.mock("@/server/services/numbering", () => ({ nextQuoteNumber: mocks.nextQuoteNumber }))
vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }))
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
vi.mock("@/lib/modules.server", () => ({
  getEntitledModuleMap: vi.fn(async () => ({ projects: false })),
}))

import { createQuotationRevision } from "@/app/(app)/quotations/actions"

type Chain = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  for: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  then: Promise<unknown>["then"]
}

function chain(value: unknown, inserts: unknown[]): Chain {
  const promise = Promise.resolve(value)
  const q = {} as Chain
  q.from = vi.fn(() => q)
  q.where = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.for = vi.fn(() => q)
  q.orderBy = vi.fn(() => q)
  q.insert = vi.fn(() => q)
  q.values = vi.fn((payload: unknown) => {
    inserts.push(payload)
    return q
  })
  q.returning = vi.fn(() => q)
  q.then = promise.then.bind(promise)
  return q
}

function txWithSelects(values: unknown[], returning: unknown[] = []) {
  const queue = [...values]
  const returnQueue = [...returning]
  const inserts: unknown[] = []
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [], inserts)),
    insert: vi.fn(() => chain(returnQueue.shift() ?? [], inserts)),
  }
  return { tx, inserts }
}

const ctx = {
  tenantId: "tenant-1",
  memberId: "member-1",
  userId: "user-1",
}

const source = {
  id: "quote-source",
  tenantId: "tenant-1",
  funnelId: "funnel-1",
  quoteNumber: "Q10001-2",
  version: 2,
  status: "accepted",
  deletedAt: null,
  isPrimary: true,
  currency: "MYR",
  projectNatureCode: "WEB",
  taxSettingId: "tax-1",
  taxRateSnapshot: "8.00",
  taxInclusive: false,
  subtotal: "100.00",
  headerDiscount: "5.00",
  discountTotal: "5.00",
  taxTotal: "7.60",
  total: "102.60",
  quoteDate: "2026-08-18",
  validUntil: "2026-09-18",
  notes: "Approved notes",
  delivery: "30 days",
  paymentTerm: "Net 30",
  attentionContactId: "contact-1",
  approverMemberId: "approver-1",
  approvedAt: new Date("2026-08-10T00:00:00Z"),
  rejectionReason: null,
  sentAt: new Date("2026-08-11T00:00:00Z"),
  acceptedAt: new Date("2026-08-12T00:00:00Z"),
}

const sourceLine = {
  id: "line-source",
  tenantId: "tenant-1",
  quotationId: "quote-source",
  productId: "product-1",
  projectNatureCode: "WEB",
  description: "Editable snapshot",
  uom: "month",
  quantity: "2",
  unitPrice: "50.00",
  discountAmount: "0.00",
  taxSettingId: "tax-1",
  lineSubtotal: "100.00",
  lineTax: "8.00",
  lineTotal: "108.00",
  sortOrder: 0,
}

describe("quotation revisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nextQuoteNumber.mockResolvedValue({ quoteNumber: "Q10001-3", version: 3 })
  })

  let currentTx: ReturnType<typeof txWithSelects>["tx"]

  it("clones the full snapshot into a Draft revision and audits the lineage", async () => {
    const created = { id: "quote-revision", quoteNumber: "Q10001-3" }
    const fixture = txWithSelects([
      [source],
      [{ ownerMemberId: "member-1" }],
      [sourceLine],
      [{ accountId: "account-1" }],
      [{ accountType: "customer", endUserAccountId: null }],
      [{ accountId: "account-1" }],
    ], [[created]])
    currentTx = fixture.tx
    mocks.withTenant.mockImplementation(async (_permission, work) => work(currentTx, ctx))

    const result = await createQuotationRevision(source.id)

    expect(result).toEqual({ ok: true, data: { id: "quote-revision", quoteNumber: "Q10001-3" } })
    expect(mocks.nextQuoteNumber).toHaveBeenCalledWith(currentTx, ctx, "funnel-1")
    expect(fixture.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-1",
        funnelId: "funnel-1",
        quoteNumber: "Q10001-3",
        version: 3,
        revisionOfId: "quote-source",
        status: "draft",
        isPrimary: false,
        attentionContactId: "contact-1",
        notes: "Approved notes",
        delivery: "30 days",
        paymentTerm: "Net 30",
        approverMemberId: null,
        approvedAt: null,
        rejectionReason: null,
        sentAt: null,
        acceptedAt: null,
        deletedAt: null,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: "tenant-1",
          quotationId: "quote-revision",
          description: "Editable snapshot",
          productId: "product-1",
          lineTotal: "108.00",
        }),
      ]),
    ]))
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      currentTx,
      ctx,
      expect.objectContaining({
        action: "quotation.revision_created",
        entityType: "quotation",
        entityId: "quote-revision",
        after: expect.objectContaining({ revisionOfId: "quote-source", version: 3 }),
      })
    )
  })

  it("rejects a live Draft but permits a soft-deleted Draft source", async () => {
    const fixture = txWithSelects([[{ ...source, status: "draft", deletedAt: null }]])
    currentTx = fixture.tx
    mocks.withTenant.mockImplementation(async (_permission, work) => work(currentTx, ctx))

    const rejected = await createQuotationRevision(source.id)

    expect(rejected).toEqual({ ok: false, error: "Only non-draft quotations can be revised" })
    expect(mocks.nextQuoteNumber).not.toHaveBeenCalled()

    const deletedSource = { ...source, status: "draft", deletedAt: new Date("2026-08-17T00:00:00Z") }
    const deletedFixture = txWithSelects([
      [deletedSource],
      [{ ownerMemberId: "member-1" }],
      [],
      [{ accountId: "account-1" }],
      [{ accountType: "customer", endUserAccountId: null }],
      [{ accountId: "account-1" }],
    ], [[{ id: "quote-revision", quoteNumber: "Q10001-3", version: 3, status: "draft" }]])
    currentTx = deletedFixture.tx
    mocks.nextQuoteNumber.mockResolvedValue({ quoteNumber: "Q10001-3", version: 3 })

    const allowed = await createQuotationRevision(source.id)

    expect(allowed).toMatchObject({ ok: true, data: { quoteNumber: "Q10001-3" } })
  })

  it("rejects a source whose attention contact no longer belongs to the recipient account", async () => {
    const fixture = txWithSelects([
      [source],
      [{ ownerMemberId: "member-1" }],
      [],
      [{ accountId: "account-1" }],
      [{ accountType: "customer", endUserAccountId: null }],
      [{ accountId: "another-account" }],
    ])
    currentTx = fixture.tx
    mocks.withTenant.mockImplementation(async (_permission, work) => work(currentTx, ctx))

    const result = await createQuotationRevision(source.id)

    expect(result).toEqual({ ok: false, error: "Attention contact must belong to recipient account" })
    expect(mocks.nextQuoteNumber).not.toHaveBeenCalled()
  })
})
