import { describe, expect, it } from "vitest"

import {
  EntitlementLeaseSchema,
  canonicalJson,
  evaluateLease,
  signEnvelope,
  verifyEnvelope,
  type EntitlementLease,
} from "../src/index.js"

const issuedAt = "2026-08-10T00:00:00.000Z"
const leaseExpiresAt = "2026-08-11T00:00:00.000Z"
const graceUntil = "2026-08-18T00:00:00.000Z"

function lease(overrides: Partial<EntitlementLease> = {}): EntitlementLease {
  return {
    schemaVersion: 1,
    keyId: "vendor-2026-08",
    leaseId: "lease-001",
    clientId: "quandatics",
    deploymentId: "quandatics-production",
    issuedAt,
    leaseExpiresAt,
    contractStartsAt: issuedAt,
    contractEndsAt: "2027-08-10T00:00:00.000Z",
    graceUntil,
    subscriptionStatus: "active",
    planId: "professional",
    maxActiveUsers: 25,
    moduleIds: ["projects", "salesOrders"],
    addonIds: [],
    configurationVersion: "config-001",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0",
    ...overrides,
  }
}

describe("canonicalJson", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ zebra: [{ y: 2, x: 1 }], alpha: { b: true, a: null } })).toBe(
      '{"alpha":{"a":null,"b":true},"zebra":[{"x":1,"y":2}]}',
    )
  })

  it("preserves JSON keys named __proto__", () => {
    expect(canonicalJson(JSON.parse('{"z":1,"__proto__":"value"}'))).toBe(
      '{"__proto__":"value","z":1}',
    )
  })

  it("sorts numeric-string keys lexicographically", () => {
    expect(canonicalJson({ 2: "two", 10: "ten", a: "letter" })).toBe(
      '{"10":"ten","2":"two","a":"letter"}',
    )
  })

  it("rejects sparse arrays", () => {
    const sparse = ["first", , "third"]

    expect(() => canonicalJson(sparse)).toThrow()
  })

  it("rejects non-finite numbers and unsupported values", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow()
    expect(() => canonicalJson({ value: undefined })).toThrow()
  })
})

describe("signed envelopes", () => {
  it("rejects an altered payload after signing", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey)
    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
    const payload = lease()
    const envelope = await signEnvelope(payload, "vendor-2026-08", privateKey)

    await expect(
      verifyEnvelope(envelope, { "vendor-2026-08": publicKey }, "quandatics-production"),
    ).resolves.toEqual(payload)

    envelope.payload.maxActiveUsers = 26

    await expect(verifyEnvelope(envelope, { "vendor-2026-08": publicKey })).resolves.toBeNull()
  })

  it("rejects a signature when the key ID resolves to the wrong public key", async () => {
    const signingPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const wrongPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const privateKey = await crypto.subtle.exportKey("jwk", signingPair.privateKey)
    const wrongPublicKey = await crypto.subtle.exportKey("jwk", wrongPair.publicKey)
    const envelope = await signEnvelope(lease(), "vendor-2026-08", privateKey)

    await expect(verifyEnvelope(envelope, { "vendor-2026-08": wrongPublicKey })).resolves.toBeNull()
  })

  it("rejects a valid envelope for a different deployment", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey)
    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
    const envelope = await signEnvelope(lease(), "vendor-2026-08", privateKey)

    await expect(
      verifyEnvelope(envelope, { "vendor-2026-08": publicKey }, "other-deployment"),
    ).resolves.toBeNull()
  })
})

describe("EntitlementLeaseSchema", () => {
  it("accepts only a 24-hour lease and known module IDs", () => {
    expect(EntitlementLeaseSchema.safeParse(lease()).success).toBe(true)
    expect(
      EntitlementLeaseSchema.safeParse(
        lease({ leaseExpiresAt: "2026-08-11T00:00:00.001Z" }),
      ).success,
    ).toBe(false)
    expect(EntitlementLeaseSchema.safeParse(lease({ moduleIds: ["unknown"] as never })).success).toBe(
      false,
    )
  })

  it("requires grace to end exactly seven days after lease expiry", () => {
    expect(EntitlementLeaseSchema.safeParse(lease()).success).toBe(true)
    expect(
      EntitlementLeaseSchema.safeParse(lease({ graceUntil: "2026-08-10T23:59:59.999Z" })).success,
    ).toBe(false)
    expect(
      EntitlementLeaseSchema.safeParse(lease({ graceUntil: "2026-08-17T23:59:59.999Z" })).success,
    ).toBe(false)
    expect(
      EntitlementLeaseSchema.safeParse(lease({ graceUntil: "2026-08-18T00:00:00.001Z" })).success,
    ).toBe(false)
  })
})

describe("evaluateLease", () => {
  it("allows writes while the lease is active", () => {
    expect(evaluateLease(lease(), "2026-08-10T12:00:00.000Z")).toMatchObject({
      mode: "active",
      writeAllowed: true,
    })
  })

  it("keeps writes available for the seven-day offline grace period", () => {
    expect(evaluateLease(lease(), "2026-08-15T00:00:00.000Z")).toMatchObject({
      mode: "grace",
      writeAllowed: true,
    })
  })

  it("blocks writes after the grace deadline", () => {
    expect(evaluateLease(lease(), "2026-08-18T00:00:00.001Z")).toMatchObject({
      mode: "read_only",
      writeAllowed: false,
    })
  })

  it("uses the greatest trusted time so a clock rollback cannot extend access", () => {
    expect(
      evaluateLease(lease(), {
        currentTime: "2026-08-10T12:00:00.000Z",
        greatestTrustedTime: "2026-08-18T00:00:00.001Z",
      }),
    ).toMatchObject({ mode: "read_only", writeAllowed: false })
  })

  it("treats past due as warning-only during lease and grace", () => {
    expect(evaluateLease(lease({ subscriptionStatus: "past_due" }), leaseExpiresAt)).toEqual({
      mode: "active",
      reason: "Lease is active; subscription is past_due",
      writeAllowed: true,
    })
    expect(evaluateLease(lease({ subscriptionStatus: "past_due" }), graceUntil)).toEqual({
      mode: "grace",
      reason: "Lease is in offline grace; subscription is past_due",
      writeAllowed: true,
    })
  })

  it("uses a half-open contract term and inclusive lease/grace deadlines", () => {
    expect(evaluateLease(lease(), issuedAt).writeAllowed).toBe(true)
    expect(evaluateLease(lease(), leaseExpiresAt).mode).toBe("active")
    expect(evaluateLease(lease(), graceUntil).mode).toBe("grace")
    expect(evaluateLease(lease(), "2027-08-10T00:00:00.000Z")).toMatchObject({
      mode: "read_only",
      reason: "Contract has ended",
      writeAllowed: false,
    })
  })

  it("makes suspended and cancelled leases immediately read-only", () => {
    for (const subscriptionStatus of ["suspended", "cancelled"] as const) {
      expect(evaluateLease(lease({ subscriptionStatus }), issuedAt)).toMatchObject({
        mode: "read_only",
        writeAllowed: false,
      })
    }
  })
})
