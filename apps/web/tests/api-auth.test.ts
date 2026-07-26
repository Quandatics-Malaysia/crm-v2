import { describe, it, expect } from "vitest"
import { generateApiKey, hashApiKey } from "@/lib/api-auth"

describe("api key helpers", () => {
  it("generates a prefixed key and a matching hash", () => {
    const { key, prefix, hash } = generateApiKey()
    expect(key.startsWith("qdk_")).toBe(true)
    expect(prefix).toBe(key.slice(0, 12))
    expect(hash).toBe(hashApiKey(key))
    expect(hash).toHaveLength(64) // sha256 hex
  })
  it("hash is stable and differs per key", () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(hashApiKey(a.key)).toBe(a.hash)
    expect(a.hash).not.toBe(b.hash)
  })
})
