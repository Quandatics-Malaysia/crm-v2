import { describe, it, expect } from "vitest"
import { money, date, enumLabel } from "@/server/services/changes/formatters"

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
