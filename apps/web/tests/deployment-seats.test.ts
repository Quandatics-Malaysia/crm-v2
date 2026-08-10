import { describe, expect, it } from "vitest"

import { normalizeSeatEmail } from "@/lib/deployment-seats"

describe("deployment seat email identity", () => {
  it.each([
    [" Person@Example.COM ", "person@example.com"],
    ["USER+tag@Example.com", "user+tag@example.com"],
    ["mixed.Case@Sub.Example.com", "mixed.case@sub.example.com"],
  ])("normalizes %j with exact trim-and-lower semantics", (input, expected) => {
    expect(normalizeSeatEmail(input)).toBe(expected)
  })

  it.each([
    "",
    "   ",
    "user\n@example.com",
    "user\u0000@example.com",
    "user @example.com",
    "user@example.com ",
  ])("rejects blank, control, or embedded-whitespace identity %j", (input) => {
    expect(() => normalizeSeatEmail(input)).toThrow("Invalid seat email")
  })
})
