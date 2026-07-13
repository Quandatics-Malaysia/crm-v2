import { describe, it, expect } from "vitest"
import { money, date, enumLabel } from "@/server/services/changes/formatters"
import { diffFields } from "@/server/services/changes/record"

const noCtx = { tx: {} as any, record: {} }
describe("change formatters", () => {
  it("formats money with default currency", async () => {
    expect(await money()("130000.00", { tx: {} as any, record: { currency: "MYR" } }))
      .toBe("RM 130,000.00")
  })
  it("formats dates", async () => {
    expect(await date()("2026-10-31", noCtx)).toBe("31 Oct 2026")
  })
  it("maps enum labels, falling back to the raw value", async () => {
    const f = enumLabel({ "2c": "Qualified", "3b": "Proposal" })
    expect(await f("2c", noCtx)).toBe("Qualified")
    expect(await f("zz", noCtx)).toBe("zz")
  })
})

describe("diffFields", () => {
  const reg = {
    name: { label: "Name" },
    amount: { label: "Amount", format: (v: any) => `RM ${v}` },
  }
  it("reports only changed fields, formatted", async () => {
    const out = await diffFields(reg as any, { name: "A", amount: "1" }, { name: "A", amount: "2" }, { tx: {} as any })
    expect(out).toEqual([{ field: "amount", label: "Amount", from: "RM 1", to: "RM 2" }])
  })
  it("returns [] when nothing user-facing changed", async () => {
    const out = await diffFields(reg as any, { name: "A", amount: "1", updatedAt: 1 }, { name: "A", amount: "1", updatedAt: 2 }, { tx: {} as any })
    expect(out).toEqual([])
  })
})
