import { generateKeyPairSync } from "node:crypto"

import { signEnvelope } from "@crm/control-protocol"
import { describe, expect, it } from "vitest"

import {
  assertCliOnly,
  databaseIdentityFromUrl,
  executeOrganizationLifecycle,
  parseOrganizationLifecycleArgs,
  verifyBackupProof,
  type BackupProofPayload,
  type OrganizationLifecycleDependencies,
  type OrganizationLifecycleRepository,
  type OrganizationLifecycleTransaction,
} from "../scripts/organization-lifecycle"

const now = new Date("2026-08-12T12:00:00.000Z")
const deploymentId = "11111111-1111-4111-8111-111111111111"
const databaseIdentity = "postgres://db.example.test:5432/crm"
const storageLocation = "s3://crm-backups/production"
const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const privateJwk = privateKey.export({ format: "jwk" })
const exportedPublicJwk = publicKey.export({ format: "jwk" })
if (
  exportedPublicJwk.kty !== "OKP" ||
  exportedPublicJwk.crv !== "Ed25519" ||
  typeof exportedPublicJwk.x !== "string"
) throw new Error("test Ed25519 public key export is invalid")
const publicJwk: OrganizationLifecycleDependencies["trustSet"]["keys"][number]["publicJwk"] = {
  kty: exportedPublicJwk.kty,
  crv: exportedPublicJwk.crv,
  x: exportedPublicJwk.x,
}

const trustSet = {
  version: 1 as const,
  keys: [{
    keyId: "backup-key-2026",
    publicJwk,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
  }],
}

async function signedProof(overrides: Partial<BackupProofPayload> = {}) {
  const payload: BackupProofPayload = {
    schemaVersion: 1,
    keyId: "backup-key-2026",
    deploymentId,
    databaseIdentity,
    storageLocation,
    createdAt: "2026-08-12T11:30:00.000Z",
    ...overrides,
  }
  return signEnvelope(payload, payload.keyId, privateJwk)
}

function verificationInput() {
  return {
    deploymentId,
    databaseIdentity,
    storageLocation,
    backupProofMaxAgeMs: 60 * 60 * 1000,
    trustSet,
    now: () => now,
  }
}

function lifecycleHarness() {
  let status: "active" | "archived" = "active"
  const audit: Array<{ action: string; actorUserId: string | null }> = []
  const repository: OrganizationLifecycleRepository = {
    transaction: async <T>(
      operation: (transaction: OrganizationLifecycleTransaction) => Promise<T>,
    ): Promise<Awaited<T>> => await operation({
      findOrganizationBySlug: async (slug) => slug === "acme" ? { id: "org-acme" } : null,
      findServerOperator: async (userId, email) =>
        userId === "operator-1" && email === "owner@example.test"
          ? { id: "operator-1" }
          : null,
      callLifecycleFunction: async (action, organizationId, actorUserId) => {
        const changed = status !== (action === "archive" ? "archived" : "active")
        status = action === "archive" ? "archived" : "active"
        if (changed) audit.push({ action: `organization.${action === "archive" ? "archived" : "restored"}`, actorUserId })
        expect(organizationId).toBe("org-acme")
      },
    }),
  }
  const dependencies: OrganizationLifecycleDependencies = {
    ...verificationInput(),
    platformMasterEmail: "owner@example.test",
    repository,
  }
  return { audit, dependencies, status: () => status }
}

describe("organization lifecycle command", () => {
  it("rejects a hostless database URL instead of deriving a fake backup identity", () => {
    expect(() => databaseIdentityFromUrl("postgres:///crm")).toThrow(/explicit hostname/)
  })

  it("rejects invalid lifecycle arguments before they can reach a database", () => {
    expect(() => parseOrganizationLifecycleArgs(["destroy", "--slug", "acme", "--actor-user-id", "operator-1", "--backup-proof", "proof.json"])).toThrow(/archive or restore/)
    expect(() => parseOrganizationLifecycleArgs(["archive", "--slug", "acme", "--backup-proof", "proof.json"])).toThrow(/actor-user-id/)
  })

  it("rejects missing, malformed, stale, and misbound backup proofs", async () => {
    await expect(verifyBackupProof(undefined, verificationInput())).rejects.toThrow(/missing/)
    await expect(verifyBackupProof({}, verificationInput())).rejects.toThrow(/malformed/)
    await expect(verifyBackupProof(await signedProof({ createdAt: "2026-08-12T10:59:59.999Z" }), verificationInput())).rejects.toThrow(/stale/)
    await expect(verifyBackupProof(await signedProof({ deploymentId: "other-deployment" }), verificationInput())).rejects.toThrow(/deployment identity/)
    await expect(verifyBackupProof(await signedProof({ databaseIdentity: "postgres://other.example.test:5432/crm" }), verificationInput())).rejects.toThrow(/database identity/)
    await expect(verifyBackupProof(await signedProof({ storageLocation: "s3://other-backups/production" }), verificationInput())).rejects.toThrow(/storage location/)
  })

  it("rejects an unknown organization slug", async () => {
    const { dependencies } = lifecycleHarness()
    await expect(executeOrganizationLifecycle({ action: "archive", slug: "missing", actorUserId: "operator-1", backupProof: await signedProof() }, dependencies)).rejects.toThrow(/organization slug not found/)
  })

  it("rejects an actor that is not the configured server operator", async () => {
    const { dependencies } = lifecycleHarness()
    await expect(executeOrganizationLifecycle({ action: "archive", slug: "acme", actorUserId: "not-operator", backupProof: await signedProof() }, dependencies)).rejects.toThrow(/configured server operator/)
  })

  it("refuses client-facing execution", () => {
    expect(() => assertCliOnly("nodejs")).toThrow(/CLI-only/)
  })

  it("archives and restores idempotently with the supplied actor as the exact audit actor", async () => {
    const { audit, dependencies, status } = lifecycleHarness()
    const backupProof = await signedProof()

    await executeOrganizationLifecycle({ action: "archive", slug: "acme", actorUserId: "operator-1", backupProof }, dependencies)
    await executeOrganizationLifecycle({ action: "archive", slug: "acme", actorUserId: "operator-1", backupProof }, dependencies)
    expect(status()).toBe("archived")
    expect(audit).toEqual([{ action: "organization.archived", actorUserId: "operator-1" }])

    await executeOrganizationLifecycle({ action: "restore", slug: "acme", actorUserId: "operator-1", backupProof }, dependencies)
    await executeOrganizationLifecycle({ action: "restore", slug: "acme", actorUserId: "operator-1", backupProof }, dependencies)
    expect(status()).toBe("active")
    expect(audit).toEqual([
      { action: "organization.archived", actorUserId: "operator-1" },
      { action: "organization.restored", actorUserId: "operator-1" },
    ])
  })
})
