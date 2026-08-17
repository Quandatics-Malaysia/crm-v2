import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerContext } from "@/lib/server-context"
import type { Tx } from "@/db"

const nextProjectCode = vi.hoisted(() => vi.fn(async () => "2026-QM-ACME-WEB-001"))

vi.mock("@/server/services/numbering", () => ({ nextProjectCode }))

import {
  createOpportunityContainer,
  ensureOpportunityProjectCode,
} from "@/server/services/opportunity-container"
import { shouldAllocateOpportunityProjectCode } from "@/server/services/stage"

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
} as ServerContext

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
})
