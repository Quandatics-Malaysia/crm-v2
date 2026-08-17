import { describe, expect, it } from "vitest"
import type { Tx } from "@/db"
import { funnels, opportunities } from "@/db/schema"
import {
  PPVVC_FIELDS,
  getPpvvcCompletion,
  type PpvvcValues,
} from "@/lib/ppvvc"
import {
  updateFunnelPpvvc,
  updateOpportunityPpvvc,
} from "@/server/services/ppvvc"

type Query = Record<string, unknown> & {
  then: Promise<unknown>["then"]
}

function query<T>(value: T): Query {
  const promise = Promise.resolve(value)
  const q = {
    from: () => q,
    where: () => q,
    limit: () => q,
    for: () => q,
    set: () => q,
    then: promise.then.bind(promise),
  } as unknown as Query
  return q
}

function fakeTx(selections: unknown[][]) {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const queue = [...selections]
  const tx = {
    select: () => query(queue.shift() ?? []),
    update: (table: unknown) => {
      const q = query([])
      q.set = (values: Record<string, unknown>) => {
        updates.push({ table, values })
        return q
      }
      return q
    },
  } as unknown as Tx
  return { tx, updates }
}

const values: PpvvcValues = {
  pain: "No approved business case",
  power: "CFO sponsor",
  vision: "Automated renewal workflow",
  value: "Reduce processing time",
  control: "Quarterly executive review",
}

describe("PPVVC metadata", () => {
  it("keeps the exact numbered Pain, Power, Vision, Value, Control order", () => {
    expect(PPVVC_FIELDS).toEqual([
      { key: "pain", number: 1, label: "Pain" },
      { key: "power", number: 2, label: "Power" },
      { key: "vision", number: 3, label: "Vision" },
      { key: "value", number: 4, label: "Value" },
      { key: "control", number: 5, label: "Control" },
    ])
  })

  it("marks each category complete from its trimmed value", () => {
    expect(
      getPpvvcCompletion({
        pain: "  identified  ",
        power: "",
        vision: null,
        value: "0",
        control: "   ",
      })
    ).toEqual([
      { key: "pain", number: 1, label: "Pain", complete: true },
      { key: "power", number: 2, label: "Power", complete: false },
      { key: "vision", number: 3, label: "Vision", complete: false },
      { key: "value", number: 4, label: "Value", complete: true },
      { key: "control", number: 5, label: "Control", complete: false },
    ])
  })
})

describe("PPVVC synchronization", () => {
  it("updates the authoritative Opportunity and only live child Funnels in one tx", async () => {
    const { tx, updates } = fakeTx([
      [
        {
          id: "opp-1",
          tenantId: "tenant-1",
          deletedAt: null,
          pain: "old pain",
          power: null,
          vision: null,
          value: null,
          control: null,
        },
      ],
      [
        { id: "funnel-live", deletedAt: null },
        { id: "funnel-deleted", deletedAt: new Date("2026-01-01") },
      ],
    ])

    const result = await updateOpportunityPpvvc(tx, {
      opportunityId: "opp-1",
      values,
      actorId: "user-1",
    })

    expect(result.updatedChildIds).toEqual(["funnel-live"])
    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      table: opportunities,
      values: { ...values },
    })
    expect(updates[1]).toMatchObject({
      table: funnels,
      values: { ...values },
    })
  })

  it("resolves a Funnel's parent before cascading a Funnel-side edit", async () => {
    const { tx, updates } = fakeTx([
      [{ id: "funnel-1", opportunityId: "opp-1", tenantId: "tenant-1", deletedAt: null }],
      [{ id: "opp-1", tenantId: "tenant-1", deletedAt: null, ...values }],
      [{ id: "funnel-1", deletedAt: null }],
    ])

    const result = await updateFunnelPpvvc(tx, {
      funnelId: "funnel-1",
      values,
      actorId: "user-1",
    })

    expect(result.opportunityId).toBe("opp-1")
    expect(updates.map((u) => u.table)).toEqual([opportunities, funnels])
    expect(updates[0].values).toMatchObject(values)
    expect(updates[1].values).toMatchObject(values)
  })
})
