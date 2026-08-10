import { canonicalJson, signEnvelope, type EntitlementLease } from "@crm/control-protocol"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  createDeploymentControlService,
  type DeploymentControlHistoryEntry,
  type DeploymentControlPersistence,
  type DeploymentEntitlementState,
  type VerifiedEntitlementApplication,
  type VendorEntitlementTrustSet,
} from "@/lib/deployment-control"

const deploymentId = "quandatics-production"
const issuedAt = "2026-08-10T00:00:00.000Z"
const leaseExpiresAt = "2026-08-11T00:00:00.000Z"
const graceUntil = "2026-08-18T00:00:00.000Z"

let privateJwk: JsonWebKey
let publicJwk: JsonWebKey

function lease(overrides: Partial<EntitlementLease> = {}): EntitlementLease {
  return {
    schemaVersion: 2,
    revision: 1,
    keyId: "vendor-2026-08",
    leaseId: "lease-001",
    clientId: "quandatics",
    deploymentId,
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

function trustSet(overrides: Partial<VendorEntitlementTrustSet["keys"][number]> = {}): VendorEntitlementTrustSet {
  return {
    version: 1,
    keys: [{
      keyId: "vendor-2026-08",
      publicJwk,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      ...overrides,
    }],
  }
}

async function signed(payload = lease(), envelopeKeyId = payload.keyId) {
  return signEnvelope(payload, envelopeKeyId, privateJwk)
}

class MemoryPersistence implements DeploymentControlPersistence {
  state: DeploymentEntitlementState | null = null
  history: DeploymentControlHistoryEntry[] = []
  private serial = Promise.resolve()

  applyVerified(input: VerifiedEntitlementApplication): Promise<{ outcome: "accepted" | "idempotent" | "rejected"; reason: string; revision: number }> {
    const operation = this.serial.then(() => {
      const current = this.state
      if (current !== null && input.deploymentId !== current.deploymentId) {
        this.history.push({ outcome: "rejected", reason: "deployment_mismatch", digest: input.digest, revision: input.revision })
        return { outcome: "rejected" as const, reason: "deployment_mismatch", revision: current.revision }
      }
      if (current !== null && input.revision < current.revision) {
        this.history.push({ outcome: "rejected", reason: "revision_downgrade", digest: input.digest, revision: input.revision })
        return { outcome: "rejected" as const, reason: "revision_downgrade", revision: current.revision }
      }
      if (current !== null && input.revision === current.revision) {
        if (input.canonicalEnvelope === current.canonicalEnvelope) {
          this.history.push({ outcome: "accepted", reason: "idempotent_replay", digest: input.digest, revision: input.revision })
          return { outcome: "idempotent" as const, reason: "idempotent_replay", revision: current.revision }
        }
        this.history.push({ outcome: "rejected", reason: "revision_conflict", digest: input.digest, revision: input.revision })
        return { outcome: "rejected" as const, reason: "revision_conflict", revision: current.revision }
      }
      this.state = {
        deploymentId: input.deploymentId,
        revision: input.revision,
        canonicalEnvelope: input.canonicalEnvelope,
        canonicalPayload: input.canonicalPayload,
        envelope: input.envelope,
        keyId: input.lease.keyId,
        issuedAt: new Date(input.lease.issuedAt),
        leaseExpiresAt: new Date(input.lease.leaseExpiresAt),
        contractStartsAt: new Date(input.lease.contractStartsAt),
        contractEndsAt: new Date(input.lease.contractEndsAt),
        graceUntil: new Date(input.lease.graceUntil),
        subscriptionStatus: input.lease.subscriptionStatus,
        seatLimit: input.lease.maxActiveUsers,
        moduleIds: [...input.lease.moduleIds],
        greatestTrustedAt: new Date(Math.max(
          Date.parse(input.lease.issuedAt),
          input.receivedAt.getTime(),
          current?.greatestTrustedAt.getTime() ?? Number.NEGATIVE_INFINITY,
        )),
      }
      this.history.push({ outcome: "accepted", reason: "accepted", digest: input.digest, revision: input.revision })
      return { outcome: "accepted" as const, reason: "accepted", revision: input.revision }
    })
    this.serial = operation.then(() => undefined)
    return operation
  }

  async recordRejected(entry: DeploymentControlHistoryEntry): Promise<void> {
    this.history.push(structuredClone(entry))
  }

  async getState(observedAt?: Date): Promise<DeploymentEntitlementState | null> {
    if (
      this.state !== null && observedAt !== undefined &&
      observedAt.getTime() >= this.state.greatestTrustedAt.getTime() + 60_000
    ) {
      this.state.greatestTrustedAt = new Date(observedAt)
    }
    return this.state === null ? null : structuredClone(this.state)
  }
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
})

let persistence: MemoryPersistence

beforeEach(() => {
  persistence = new MemoryPersistence()
})

describe("applySignedEntitlement", () => {
  it("verifies and persists exact canonical last-known-good bytes", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet(),
      now: () => new Date(issuedAt),
    })
    const envelope = await signed()

    await expect(service.applySignedEntitlement(envelope, deploymentId)).resolves.toMatchObject({
      outcome: "accepted",
      revision: 1,
    })
    expect(persistence.state).toMatchObject({
      deploymentId,
      revision: 1,
      canonicalEnvelope: canonicalJson(envelope),
      canonicalPayload: canonicalJson(envelope.payload),
      seatLimit: 25,
      moduleIds: ["projects", "salesOrders"],
      greatestTrustedAt: new Date(issuedAt),
    })
  })

  it("rejects unknown keys, key-ID substitution, tampering, wrong deployments, and strict-schema failures", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    const valid = await signed()
    await service.applySignedEntitlement(valid, deploymentId)

    const wrongDeployment = await signed(lease({ revision: 2, deploymentId: "other" }))
    const unknownKey = await signed(lease({ revision: 2, keyId: "unknown" }), "unknown")
    const substitutedKeyId = await signed(lease({ revision: 2 }), "envelope-key")
    const tampered = structuredClone(await signed(lease({ revision: 2 })))
    tampered.payload.maxActiveUsers = 99
    const malformedPayload = { ...lease({ revision: 2 }), unexpected: true }
    const malformed = await signEnvelope(malformedPayload, malformedPayload.keyId, privateJwk)

    for (const envelope of [wrongDeployment, unknownKey, substitutedKeyId, tampered, malformed]) {
      await expect(service.applySignedEntitlement(envelope, deploymentId)).resolves.toMatchObject({ outcome: "rejected" })
      expect(persistence.state?.canonicalEnvelope).toBe(canonicalJson(valid))
    }
    expect(persistence.history.filter((entry) => entry.outcome === "rejected")).toHaveLength(5)
    expect(JSON.stringify(persistence.history)).not.toContain("unexpected")
  })

  it("enforces trust-key validity at the signed issue instant", async () => {
    for (const invalidTrust of [
      trustSet({ validFrom: "2026-08-10T00:00:00.001Z" }),
      trustSet({ validUntil: issuedAt }),
    ]) {
      const service = createDeploymentControlService({
        persistence: new MemoryPersistence(),
        trustSet: invalidTrust,
        now: () => new Date(issuedAt),
      })
      await expect(service.applySignedEntitlement(await signed(), deploymentId)).resolves.toMatchObject({
        outcome: "rejected",
        reason: "trust_key_not_valid",
      })
    }
  })

  it.each([
    ["2026-08-10T00:00:00.000Z", "accepted"],
    ["2026-08-10T23:59:59.999Z", "accepted"],
    ["2026-08-09T23:59:59.999Z", "rejected"],
    ["2026-08-11T00:00:00.000Z", "rejected"],
  ] as const)("requires receipt time %s inside the half-open trust window", async (receivedAt, outcome) => {
    const store = new MemoryPersistence()
    const service = createDeploymentControlService({
      persistence: store,
      trustSet: trustSet({
        validFrom: "2026-08-10T00:00:00.000Z",
        validUntil: "2026-08-11T00:00:00.000Z",
      }),
      now: () => new Date(receivedAt),
    })

    await expect(service.applySignedEntitlement(await signed(), deploymentId)).resolves.toMatchObject({ outcome })
  })

  it("rejects a newly applied bundle after its signing key is revoked from the trust set", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet({ keyId: "replacement-key" }),
      now: () => new Date(issuedAt),
    })

    await expect(service.applySignedEntitlement(await signed(), deploymentId)).resolves.toMatchObject({
      outcome: "rejected",
      reason: "unknown_key",
    })
  })

  it("continues evaluating an accepted last-known-good lease after its trust key expires", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet({ validUntil: "2026-08-10T06:00:00.000Z" }),
      now: () => new Date("2026-08-10T05:00:00.000Z"),
    })
    await service.applySignedEntitlement(await signed(), deploymentId)

    await expect(service.getDeploymentAccess(new Date("2026-08-10T12:00:00.000Z"))).resolves.toMatchObject({
      mode: "active",
      writeAllowed: true,
    })
  })

  it("rejects signed legacy schema-v1 bundles from new enforcement state", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet(),
      now: () => new Date(issuedAt),
    })
    const { revision: _revision, ...withoutRevision } = lease()
    const legacy = { ...withoutRevision, schemaVersion: 1 }

    await expect(service.applySignedEntitlement(
      await signEnvelope(legacy, legacy.keyId, privateJwk), deploymentId,
    )).resolves.toMatchObject({ outcome: "rejected", reason: "invalid_payload" })
  })

  it("rejects an already-expired incoming lease without replacing last-known-good", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet(),
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    })
    const valid = await signed()
    await service.applySignedEntitlement(valid, deploymentId)
    const expired = await signed(lease({
      revision: 2,
      leaseId: "expired-lease",
      issuedAt: "2026-08-01T00:00:00.000Z",
      leaseExpiresAt: "2026-08-02T00:00:00.000Z",
      graceUntil: "2026-08-09T00:00:00.000Z",
    }))

    await expect(service.applySignedEntitlement(expired, deploymentId)).resolves.toMatchObject({
      outcome: "rejected",
      reason: "expired_lease",
    })
    expect(persistence.state?.canonicalEnvelope).toBe(canonicalJson(valid))
  })

  it("rejects dependency-incomplete modules but accepts the complete known module catalog", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    await expect(service.applySignedEntitlement(
      await signed(lease({ moduleIds: ["finance"] })), deploymentId,
    )).resolves.toMatchObject({ outcome: "rejected", reason: "invalid_modules" })

    await expect(service.applySignedEntitlement(await signed(lease({
      moduleIds: ["projects", "salesOrders", "finance", "forecast", "audit", "advancedRoles", "documentation"],
    })), deploymentId)).resolves.toMatchObject({ outcome: "accepted" })
  })

  it("rejects downgrades and conflicting same revisions but permits byte-identical replay", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    const revisionTwo = await signed(lease({ revision: 2, leaseId: "lease-002" }))
    await service.applySignedEntitlement(revisionTwo, deploymentId)

    await expect(service.applySignedEntitlement(await signed(), deploymentId)).resolves.toMatchObject({
      outcome: "rejected", reason: "revision_downgrade", revision: 2,
    })
    await expect(service.applySignedEntitlement(revisionTwo, deploymentId)).resolves.toMatchObject({
      outcome: "idempotent", reason: "idempotent_replay", revision: 2,
    })
    await expect(service.applySignedEntitlement(
      await signed(lease({ revision: 2, leaseId: "lease-002-conflict" })), deploymentId,
    )).resolves.toMatchObject({ outcome: "rejected", reason: "revision_conflict", revision: 2 })
    expect(persistence.state?.canonicalEnvelope).toBe(canonicalJson(revisionTwo))
  })

  it("serializes concurrent revisions and retains the highest accepted revision", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    const revisions = await Promise.all([2, 4, 3].map(async (revision) =>
      service.applySignedEntitlement(await signed(lease({ revision, leaseId: `lease-${revision}` })), deploymentId)))

    expect(revisions.some((result) => result.revision === 4)).toBe(true)
    expect(persistence.state?.revision).toBe(4)
    expect(persistence.history).toHaveLength(3)
  })
})

describe("getDeploymentAccess", () => {
  it("fails closed without a readable last-known-good bundle", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    await expect(service.getDeploymentAccess(new Date(issuedAt))).resolves.toEqual({
      mode: "read_only",
      reason: "No valid entitlement bundle is available",
      writeAllowed: false,
      seatLimit: 0,
      moduleIds: [],
      leaseExpiresAt: null,
      graceUntil: null,
      contractStartsAt: null,
      contractEndsAt: null,
      revision: null,
      configurationVersion: null,
    })
  })

  it.each([
    [leaseExpiresAt, "active", true],
    ["2026-08-11T00:00:00.001Z", "grace", true],
    [graceUntil, "grace", true],
    ["2026-08-18T00:00:00.001Z", "read_only", false],
    ["2027-08-10T00:00:00.000Z", "read_only", false],
  ] as const)("evaluates exact lease and contract boundary %s", async (now, mode, writeAllowed) => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    await service.applySignedEntitlement(await signed(), deploymentId)
    await expect(service.getDeploymentAccess(new Date(now))).resolves.toMatchObject({
      mode,
      writeAllowed,
      revision: 1,
      configurationVersion: "config-001",
    })
  })

  it("uses a half-open contract term at the exact start boundary", async () => {
    const service = createDeploymentControlService({
      persistence,
      trustSet: trustSet(),
      now: () => new Date(issuedAt),
    })
    await service.applySignedEntitlement(await signed(lease({
      contractStartsAt: "2026-08-10T12:00:00.000Z",
    })), deploymentId)

    await expect(service.getDeploymentAccess(new Date("2026-08-10T11:59:59.999Z"))).resolves.toMatchObject({
      mode: "read_only",
      reason: "Contract has not started",
    })
    await expect(service.getDeploymentAccess(new Date("2026-08-10T12:00:00.000Z"))).resolves.toMatchObject({
      mode: "active",
      writeAllowed: true,
    })
  })

  it.each([
    ["active", "active", true],
    ["past_due", "active", true],
    ["suspended", "read_only", false],
    ["cancelled", "read_only", false],
  ] as const)("evaluates %s status", async (subscriptionStatus, mode, writeAllowed) => {
    const store = new MemoryPersistence()
    const service = createDeploymentControlService({ persistence: store, trustSet: trustSet() })
    await service.applySignedEntitlement(await signed(lease({ subscriptionStatus })), deploymentId)
    await expect(service.getDeploymentAccess(new Date("2026-08-10T12:00:00.000Z"))).resolves.toMatchObject({ mode, writeAllowed })
  })

  it("uses persisted greatest trusted time when wall clock rolls back", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    await service.applySignedEntitlement(await signed(), deploymentId)
    persistence.state!.greatestTrustedAt = new Date("2026-08-18T00:00:00.001Z")

    await expect(service.getDeploymentAccess(new Date("2026-08-10T00:00:00.000Z"))).resolves.toMatchObject({
      mode: "read_only",
      writeAllowed: false,
    })
  })

  it("durably advances trusted time during access before a later wall-clock rollback", async () => {
    const service = createDeploymentControlService({ persistence, trustSet: trustSet() })
    await service.applySignedEntitlement(await signed(), deploymentId)

    await expect(service.getDeploymentAccess(new Date("2026-08-18T00:00:00.001Z"))).resolves.toMatchObject({
      mode: "read_only",
    })
    await expect(service.getDeploymentAccess(new Date("2026-08-10T00:00:00.000Z"))).resolves.toMatchObject({
      mode: "read_only",
      writeAllowed: false,
    })
  })
})
