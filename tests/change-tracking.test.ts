import { describe, it, expect } from "vitest"
import { money, date, enumLabel } from "@/server/services/changes/formatters"
import { diffFields } from "@/server/services/changes/record"
import type { FieldRegistry } from "@/server/services/changes/types"
import type { Tx } from "@/db"

// These tests never exercise a formatter that touches `tx`, so a bare stub is safe.
const mockTx = {} as unknown as Tx
const noCtx = { tx: mockTx, record: {} }
// Intl currency formatting inserts a narrow no-break space (U+202F); `\s` matches
// it, so normalize all whitespace to a plain space before asserting.
const norm = (s: string) => s.replace(/\s/g, " ")

describe("change formatters", () => {
  it("formats money with default currency", async () => {
    expect(norm(await money()("130000.00", { tx: mockTx, record: { currency: "MYR" } })))
      .toBe("RM 130,000.00")
  })
  it("formats dates", async () => {
    expect(norm(await date()("2026-10-31", noCtx))).toBe("31 Oct 2026")
  })
  it("maps enum labels, falling back to the raw value", async () => {
    const f = enumLabel({ "2c": "Qualified", "3b": "Proposal" })
    expect(await f("2c", noCtx)).toBe("Qualified")
    expect(await f("zz", noCtx)).toBe("zz")
  })
})

describe("diffFields", () => {
  const reg: FieldRegistry = {
    name: { label: "Name" },
    amount: { label: "Amount", format: (v) => `RM ${String(v)}` },
  }
  it("reports only changed fields, formatted", async () => {
    const out = await diffFields(reg, { name: "A", amount: "1" }, { name: "A", amount: "2" }, { tx: mockTx })
    expect(out).toEqual([{ field: "amount", label: "Amount", from: "RM 1", to: "RM 2" }])
  })
  it("returns [] when nothing user-facing changed", async () => {
    const out = await diffFields(reg, { name: "A", amount: "1", updatedAt: 1 }, { name: "A", amount: "1", updatedAt: 2 }, { tx: mockTx })
    expect(out).toEqual([])
  })
})
