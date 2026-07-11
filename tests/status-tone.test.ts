import { describe, expect, it } from "vitest"
import { statusTone } from "@/components/status-badge"

describe("statusTone", () => {
  it("maps terminal outcomes to the right semantic tone", () => {
    expect(statusTone("won")).toBe("success")
    expect(statusTone("paid")).toBe("success")
    expect(statusTone("settled")).toBe("success")
    expect(statusTone("lost")).toBe("danger")
    expect(statusTone("cancelled")).toBe("danger")
    expect(statusTone("pending")).toBe("warning")
    expect(statusTone("open")).toBe("info")
    expect(statusTone("draft")).toBe("neutral")
  })

  it("is case-insensitive and falls back to neutral for unknown statuses", () => {
    expect(statusTone("WON")).toBe("success")
    expect(statusTone("something_else")).toBe("neutral")
    expect(statusTone("")).toBe("neutral")
  })
})
