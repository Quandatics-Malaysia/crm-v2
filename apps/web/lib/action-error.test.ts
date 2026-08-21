import { describe, expect, it } from "vitest"

import { normalizeActionError } from "./action-error"

describe("normalizeActionError", () => {
  it("keeps expected validation messages", () => {
    expect(normalizeActionError(new Error("Title is required"))).toEqual({
      code: "validation_error",
      message: "Title is required",
    })
  })

  it("classifies authorization and missing-record failures", () => {
    expect(normalizeActionError(new Error("FORBIDDEN: missing account.view")).code).toBe(
      "forbidden"
    )
    expect(normalizeActionError(new Error("Quotation not found")).code).toBe(
      "not_found"
    )
    expect(normalizeActionError(new Error("UNAUTHENTICATED"))).toEqual({
      code: "unauthenticated",
      message: "Your session has expired. Sign in again and retry.",
    })
  })

  it("does not expose technical or unknown exception details", () => {
    const result = normalizeActionError(
      new Error('select * from "private_table" failed: relation does not exist')
    )
    expect(result).toEqual({
      code: "internal_error",
      message: "We couldn’t complete this request. Please try again.",
    })
    expect(normalizeActionError(new Error("boom")).code).toBe("internal_error")
  })
})
