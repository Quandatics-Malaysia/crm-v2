import { describe, expect, it } from "vitest"

import {
  CommandAckSchema,
  CommandEnvelopeSchema,
  CommandPayloadSchema,
  commandTtlBounds,
  isCommandExpired,
  signCommandEnvelope,
  verifyCommandEnvelope,
  type CommandEnvelopePayload,
} from "../src/index.js"

function makePayload(overrides: Partial<CommandEnvelopePayload> = {}): CommandEnvelopePayload {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    deploymentId: "22222222-2222-4222-8222-222222222222",
    payload: { kind: "echo", message: "ping" },
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T00:05:00.000Z",
    agentVersionMin: null,
    ...overrides,
  }
}

describe("command payload discriminated union", () => {
  it("echoes accept only a non-empty message", () => {
    expect(CommandPayloadSchema.safeParse({ kind: "echo", message: "" }).success).toBe(false)
    expect(CommandPayloadSchema.safeParse({ kind: "echo", message: "ping" }).success).toBe(true)
  })

  it("trigger_backup requires artifactTag matching the safe pattern", () => {
    expect(CommandPayloadSchema.safeParse({
      kind: "trigger_backup",
      requestedAt: "2026-08-19T00:00:00.000Z",
      artifactTag: "bad tag",
    }).success).toBe(false)
    expect(CommandPayloadSchema.safeParse({
      kind: "trigger_backup",
      requestedAt: "2026-08-19T00:00:00.000Z",
      artifactTag: "release-1.2.3",
    }).success).toBe(true)
  })

  it("restart_web/restart_gateway refuse unknown service names", () => {
    expect(CommandPayloadSchema.safeParse({ kind: "restart_web", service: "agent", reason: "x" }).success).toBe(false)
    expect(CommandPayloadSchema.safeParse({ kind: "restart_web", service: "web", reason: "x" }).success).toBe(true)
  })
})

describe("command envelope signing", () => {
  it("rejects unsigned/invalid envelopes", () => {
    const parsed = CommandEnvelopeSchema.safeParse({ keyId: "vendor", payload: {}, signature: "x" })
    expect(parsed.success).toBe(false)
  })

  it("verifies signature with the matching key and rejects unknown/expired", async () => {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
    const envelope = await signCommandEnvelope({
      payload: makePayload(),
      keyId: "vendor-2026-08",
      privateKey: pair.privateKey,
    })
    const now = new Date("2026-08-19T00:01:00.000Z")
    const verified = await verifyCommandEnvelope({
      envelope,
      publicKeys: { "vendor-2026-08": { kty: "OKP", crv: "Ed25519", x: publicJwk.x } },
      now,
    })
    expect(verified).not.toBeNull()

    const tampered = { ...envelope, payload: { ...envelope.payload, deploymentId: "00000000-0000-4000-8000-000000000000" } }
    expect(await verifyCommandEnvelope({
      envelope: tampered,
      publicKeys: { "vendor-2026-08": { kty: "OKP", crv: "Ed25519", x: publicJwk.x } },
      now,
    })).toBeNull()

    const expired = await signCommandEnvelope({
      payload: makePayload({ issuedAt: "2026-08-18T00:00:00.000Z", expiresAt: "2026-08-18T00:01:00.000Z" }),
      keyId: "vendor-2026-08",
      privateKey: pair.privateKey,
    })
    const futureExpired = await verifyCommandEnvelope({
      envelope: expired,
      publicKeys: { "vendor-2026-08": { kty: "OKP", crv: "Ed25519", x: publicJwk.x } },
      now: new Date("2026-08-19T00:02:00.000Z"),
    })
    expect(futureExpired).toBeNull()

    const issuedInFuture = await signCommandEnvelope({
      payload: makePayload({ issuedAt: "2026-08-19T00:02:30.000Z", expiresAt: "2026-08-19T00:07:30.000Z" }),
      keyId: "vendor-2026-08",
      privateKey: pair.privateKey,
    })
    const futureIssued = await verifyCommandEnvelope({
      envelope: issuedInFuture,
      publicKeys: { "vendor-2026-08": { kty: "OKP", crv: "Ed25519", x: publicJwk.x } },
      now: new Date("2026-08-19T00:02:00.000Z"),
    })
    expect(futureIssued).toBeNull()
  })
})

describe("command TTL helpers", () => {
  it("rounds issuedAt down to the wall-clock second", () => {
    const bounds = commandTtlBounds(new Date("2026-08-19T00:00:00.450Z"))
    expect(bounds.issuedAt).toMatch(/T00:00:00\.000Z$/)
    const expiresAt = Date.parse(bounds.expiresAt) - Date.parse(bounds.issuedAt)
    expect(expiresAt).toBeGreaterThan(0)
    expect(expiresAt).toBeLessThanOrEqual(5 * 60 * 1_000 + 1_000)
  })

  it("clamps requested TTL to the maximum", () => {
    const bounds = commandTtlBounds(new Date("2026-08-19T00:00:00.000Z"), 7 * 24 * 60 * 60 * 1_000)
    const expiresAt = Date.parse(bounds.expiresAt) - Date.parse(bounds.issuedAt)
    expect(expiresAt).toBeLessThanOrEqual(24 * 60 * 60 * 1_000)
  })

  it("isCommandExpired matches the expiresAt boundary", () => {
    expect(isCommandExpired(
      makePayload({ issuedAt: "2026-08-19T00:00:00.000Z", expiresAt: "2026-08-19T00:01:00.000Z" }),
      new Date("2026-08-19T00:01:00.000Z"),
    )).toBe(true)
    expect(isCommandExpired(
      makePayload({ issuedAt: "2026-08-19T00:00:00.000Z", expiresAt: "2026-08-19T00:01:00.000Z" }),
      new Date("2026-08-19T00:00:59.000Z"),
    )).toBe(false)
  })
})

describe("command ack schema", () => {
  it("enforces default outcome=completed, errorCode=null, artifact=null", () => {
    const parsed = CommandAckSchema.parse({
      commandId: "11111111-1111-4111-8111-111111111111",
      deploymentId: "22222222-2222-4222-8222-222222222222",
      status: "ok",
      completedAt: "2026-08-19T00:01:00.000Z",
      agentVersion: "1.0.0",
    })
    expect(parsed.outcome).toBe("completed")
    expect(parsed.errorCode).toBeNull()
    expect(parsed.artifact).toBeNull()
  })

  it("rejects artifacts without a 32-byte sha256 digest", () => {
    const result = CommandAckSchema.safeParse({
      commandId: "11111111-1111-4111-8111-111111111111",
      deploymentId: "22222222-2222-4222-8222-222222222222",
      status: "ok",
      completedAt: "2026-08-19T00:01:00.000Z",
      agentVersion: "1.0.0",
      artifact: {
        kind: "diagnostic_bundle",
        sha256: "not-hex",
        byteLength: 1,
        contentType: "application/json",
        storageKey: "x",
      },
    })
    expect(result.success).toBe(false)
  })
})
