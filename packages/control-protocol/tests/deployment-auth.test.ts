import { describe, expect, it } from "vitest"

import {
  deploymentRequestTranscript,
  fromBase64Url,
  lowercaseHex,
  parseCanonicalRequestTimestamp,
  sha256,
  toBase64Url,
} from "../src/deployment-auth.js"

const encoder = new TextEncoder()

describe("deployment request authentication protocol", () => {
  it("builds the exact interoperable request transcript", () => {
    const transcript = deploymentRequestTranscript({
      method: "GET",
      path: "/v1/deployments/11111111-1111-4111-8111-111111111111/entitlement/7",
      deploymentId: "11111111-1111-4111-8111-111111111111",
      keyId: "22222222-2222-4222-8222-222222222222",
      timestamp: "2026-08-10T01:02:03.004Z",
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      bodyDigestHex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    })

    expect(new TextDecoder().decode(transcript)).toBe(
      "crm-deployment-request-v1\nGET\n/v1/deployments/11111111-1111-4111-8111-111111111111/entitlement/7\n11111111-1111-4111-8111-111111111111\n22222222-2222-4222-8222-222222222222\n2026-08-10T01:02:03.004Z\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\nsha-256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n",
    )
  })

  it("round-trips canonical base64url and rejects alternate encodings", () => {
    const bytes = new Uint8Array(32)
    bytes[0] = 251
    const encoded = toBase64Url(bytes)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(fromBase64Url(encoded, 32)).toEqual(bytes)
    expect(() => fromBase64Url(`${encoded}=`, 32)).toThrow(TypeError)
    expect(() => fromBase64Url(encoded.replace("-", "+"), 32)).toThrow(TypeError)
  })

  it("hashes exact bytes and validates canonical timestamps within bounded skew", async () => {
    expect(lowercaseHex(await sha256(encoder.encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    const now = new Date("2026-08-10T01:05:00.000Z")
    expect(parseCanonicalRequestTimestamp("2026-08-10T01:02:03.004Z", now).toISOString())
      .toBe("2026-08-10T01:02:03.004Z")
    expect(() => parseCanonicalRequestTimestamp("2026-08-10T01:02:03Z", now)).toThrow(TypeError)
    expect(() => parseCanonicalRequestTimestamp("2026-08-10T00:59:59.999Z", now)).toThrow(TypeError)
  })
})
