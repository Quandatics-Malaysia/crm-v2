import { describe, expect, it } from "vitest"
import { formatQuoteRef, QUOTE_FORMAT_CUTOFF, QUOTE_PAD_WIDTH } from "@/lib/quote-number"

describe("formatQuoteRef", () => {
  it("old format for a funnel whose earliest quote predates 1 Sept 2025", () => {
    expect(
      formatQuoteRef({
        running: 1,
        rev: 1,
        earliestQuoteDate: new Date("2025-03-15T10:00:00.000Z"),
      })
    ).toBe("Q25-0001-1")
  })

  it("new format for a funnel whose earliest quote is on/after 1 Sept 2025", () => {
    expect(
      formatQuoteRef({
        running: 1,
        rev: 1,
        earliestQuoteDate: new Date("2025-09-15T10:00:00.000Z"),
      })
    ).toBe("Q10001-1")
  })

  it("new format when there is no earlier quote (this call is the funnel's first)", () => {
    expect(
      formatQuoteRef({ running: 1, rev: 1, earliestQuoteDate: null })
    ).toBe("Q10001-1")
  })

  it("the cutoff instant itself counts as new format (not '<')", () => {
    expect(
      formatQuoteRef({ running: 1, rev: 1, earliestQuoteDate: QUOTE_FORMAT_CUTOFF })
    ).toBe("Q10001-1")
  })

  it("one millisecond before the cutoff is old format", () => {
    const justBefore = new Date(QUOTE_FORMAT_CUTOFF.getTime() - 1)
    expect(
      formatQuoteRef({ running: 1, rev: 1, earliestQuoteDate: justBefore })
    ).toBe("Q25-0001-1")
  })

  it("derives yy from the earliest quote's year, not the current year", () => {
    expect(
      formatQuoteRef({
        running: 7,
        rev: 1,
        earliestQuoteDate: new Date("2024-01-01T00:00:00.000Z"),
      })
    ).toBe("Q24-0007-1")
  })

  it("increments the revision suffix while the running number stays fixed", () => {
    const earliestQuoteDate = new Date("2025-09-01T00:00:00.000Z")
    expect(formatQuoteRef({ running: 42, rev: 1, earliestQuoteDate })).toBe(
      "Q10042-1"
    )
    expect(formatQuoteRef({ running: 42, rev: 2, earliestQuoteDate })).toBe(
      "Q10042-2"
    )
    expect(formatQuoteRef({ running: 42, rev: 3, earliestQuoteDate })).toBe(
      "Q10042-3"
    )
  })

  it("zero-pads the running number to the given width, default 4", () => {
    expect(
      formatQuoteRef({ running: 3, rev: 1, earliestQuoteDate: null })
    ).toBe("Q10003-1")
    expect(QUOTE_PAD_WIDTH).toBe(4)
    expect(
      formatQuoteRef({ running: 3, rev: 1, earliestQuoteDate: null, pad: 6 })
    ).toBe("Q1000003-1")
    expect(
      formatQuoteRef({ running: 3, rev: 1, earliestQuoteDate: null, pad: 2 })
    ).toBe("Q103-1")
  })

  it("does not truncate a running number wider than the pad width", () => {
    expect(
      formatQuoteRef({ running: 12345, rev: 1, earliestQuoteDate: null, pad: 4 })
    ).toBe("Q112345-1")
  })

  it("old-format padding follows the same rule", () => {
    expect(
      formatQuoteRef({
        running: 123,
        rev: 5,
        earliestQuoteDate: new Date("2025-01-01T00:00:00.000Z"),
        pad: 4,
      })
    ).toBe("Q25-0123-5")
  })
})
