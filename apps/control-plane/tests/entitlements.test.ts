import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { canonicalJson, evaluateLease, signEnvelope, verifyEnvelope, type EntitlementLease, type SignedEnvelope } from "@crm/control-protocol"
import { deploymentRequestTranscript, lowercaseHex, sha256, toBase64Url } from "@crm/control-protocol/deployment-auth"
import { createApp } from "../src/index"
import { publicKeyFingerprint } from "../src/auth/deployment"
import {
  assignEntitlementSchedule,
  getCurrentEntitlementReference,
  getEntitlement,
  issueEntitlement,
  runEntitlementRenewal,
  updateEntitlementControls,
} from "../src/repos/entitlements"

const now = new Date("2026-08-10T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1_000
const ownerId = crypto.randomUUID()
let privateJwk: JsonWebKey
let publicJwk: JsonWebKey

function bindings(database: D1Database = env.CONTROL_DB, overrides: Record<string, unknown> = {}): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-a",
    ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
    ...overrides,
  } as unknown as CloudflareBindings
}

async function seed(options: {
  status?: "active" | "past_due" | "suspended" | "cancelled"
  startsAt?: string
  endsAt?: string
  seatLimit?: number
  modules?: string[]
  deploymentStatus?: string
} = {}) {
  const clientId = crypto.randomUUID()
  const deploymentId = crypto.randomUUID()
  const contractId = crypto.randomUUID()
  const createdAt = now.toISOString()
  const modules = options.modules ?? ["projects", "salesOrders", "finance"]
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Client', 'active', ?, ?)")
      .bind(clientId, `client-${clientId}`, createdAt, createdAt),
    env.CONTROL_DB.prepare("INSERT INTO deployments (id, client_id, deployment_key, environment, status, registered_at, registration_key_fingerprint, created_at, updated_at) VALUES (?, ?, ?, 'production', ?, ?, ?, ?, ?)")
      .bind(deploymentId, clientId, `deployment-${deploymentId}`, options.deploymentStatus ?? "active", createdAt, "registered", createdAt, createdAt),
    env.CONTROL_DB.prepare("INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', '{}', ?, ?, NULL, NULL, NULL, NULL, ?)")
      .bind(crypto.randomUUID(), deploymentId, crypto.randomUUID(), "r".repeat(43), createdAt, createdAt),
    env.CONTROL_DB.prepare("INSERT OR IGNORE INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('plan-pro', 'pro', 'Pro', 1, ?, ?)")
      .bind(createdAt, createdAt),
    env.CONTROL_DB.prepare("INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'plan-pro', ?, ?, ?, ?, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)")
      .bind(contractId, clientId, options.status ?? "active", options.startsAt ?? "2026-08-01", options.endsAt ?? "2026-12-31", options.seatLimit ?? 25, createdAt, createdAt),
  ])
  const catalog: Record<string, string[]> = {
    projects: [], salesOrders: ["projects"], finance: ["projects", "salesOrders"],
    forecast: [], audit: [], advancedRoles: [], documentation: [],
  }
  for (const moduleId of modules) {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT OR IGNORE INTO module_catalog (module_id, display_name, dependency_ids_json, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(moduleId, moduleId, JSON.stringify(catalog[moduleId] ?? []), createdAt, createdAt),
      env.CONTROL_DB.prepare("INSERT INTO contract_modules (contract_id, module_id, created_at) VALUES (?, ?, ?)")
        .bind(contractId, moduleId, createdAt),
    ])
  }
  await assignEntitlementSchedule(env.CONTROL_DB, {
    deploymentId, contractId, configurationVersion: "config-1", releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0", approvedImageDigest: `sha256:${"a".repeat(64)}`,
  }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
  return { clientId, deploymentId, contractId }
}

async function issue(fixture: Awaited<ReturnType<typeof seed>>, at = now, environment = bindings()) {
  return issueEntitlement(environment, {
    deploymentId: fixture.deploymentId,
    contractId: fixture.contractId,
    issuanceKey: `manual:${crypto.randomUUID()}`,
    actor: { operatorId: ownerId, requestId: crypto.randomUUID(), source: "operator" },
    now: at,
  })
}

async function count(table: string, where = "", bind: string[] = []) {
  const row = await env.CONTROL_DB.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).bind(...bind).first<{ count: number }>()
  return row?.count ?? 0
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  await env.CONTROL_DB.prepare("INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, 'owner@example.com', 'active', 'owner', ?, ?)")
    .bind(ownerId, now.toISOString(), now.toISOString()).run()
})

describe("entitlement issuance", () => {
  it("requires registration and a currently compatible contract before scheduling", async () => {
    const unregistered = await seed()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("DELETE FROM deployment_entitlement_schedules WHERE deployment_id = ?").bind(unregistered.deploymentId),
      env.CONTROL_DB.prepare("UPDATE deployments SET registered_at = NULL, registration_key_fingerprint = NULL WHERE id = ?").bind(unregistered.deploymentId),
      env.CONTROL_DB.prepare("UPDATE deployment_keys SET revoked_at = ? WHERE deployment_id = ?").bind(now.toISOString(), unregistered.deploymentId),
    ])
    await expect(assignEntitlementSchedule(env.CONTROL_DB, {
      deploymentId: unregistered.deploymentId,
      contractId: unregistered.contractId,
      configurationVersion: "config-unregistered",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
    }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toMatchObject({ status: 400 })

    const incompatible = await seed()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("DELETE FROM deployment_entitlement_schedules WHERE deployment_id = ?").bind(incompatible.deploymentId),
      env.CONTROL_DB.prepare("UPDATE contracts SET status = 'cancelled' WHERE id = ?").bind(incompatible.contractId),
    ])
    await expect(assignEntitlementSchedule(env.CONTROL_DB, {
      deploymentId: incompatible.deploymentId,
      contractId: incompatible.contractId,
      configurationVersion: "config-cancelled",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
    }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toMatchObject({ status: 400 })
  })

  it("rejects malformed schedule release controls", async () => {
    const fixture = await seed()
    for (const invalid of [
      { configurationVersion: "", releaseChannel: "stable", minimumSupportedAppVersion: "1.0.0", approvedImageDigest: null },
      { configurationVersion: "config", releaseChannel: "nightly", minimumSupportedAppVersion: "1.0.0", approvedImageDigest: null },
      { configurationVersion: "config", releaseChannel: "stable", minimumSupportedAppVersion: "", approvedImageDigest: null },
      { configurationVersion: "config", releaseChannel: "stable", minimumSupportedAppVersion: "1.0.0", approvedImageDigest: "sha256:ABC" },
    ]) {
      await expect(assignEntitlementSchedule(env.CONTROL_DB, {
        deploymentId: fixture.deploymentId,
        contractId: fixture.contractId,
        ...invalid,
      } as never, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toMatchObject({ status: 400 })
    }
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).run()
  })

  it("rejects an already stale reviewed state before signing", async () => {
    const fixture = await seed()

    await expect(issueEntitlement(bindings(), {
      deploymentId: fixture.deploymentId,
      contractId: fixture.contractId,
      issuanceKey: `manual:${crypto.randomUUID()}`,
      expectedContractRevision: 1,
      expectedScheduleRevision: 2,
      actor: { operatorId: ownerId, requestId: crypto.randomUUID(), source: "operator" },
      now,
    })).rejects.toMatchObject({ status: 409, code: "entitlement_state_changed" })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).run()
  })

  it.each([
    {
      label: "the client is disabled after review",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>) => env.CONTROL_DB.prepare(
        "UPDATE clients SET status = 'disabled' WHERE id = ?",
      ).bind(fixture.clientId).run(),
    },
    {
      label: "the deployment key is revoked after review",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>) => env.CONTROL_DB.prepare(
        "UPDATE deployment_keys SET revoked_at = ? WHERE deployment_id = ?",
      ).bind(now.toISOString(), fixture.deploymentId).run(),
    },
  ])("rejects issuance when $label", async ({ invalidate }) => {
    const fixture = await seed()
    await invalidate(fixture)

    await expect(issue(fixture)).rejects.toMatchObject({
      status: 409,
      code: "entitlement_prerequisites_unavailable",
    })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.issue' AND target_id = ?", [fixture.deploymentId])).toBe(0)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).run()
  })

  it("issues core CRM entitlement with no optional modules", async () => {
    const fixture = await seed({ modules: [] })

    const result = await issue(fixture)

    expect(result.envelope.payload.moduleIds).toEqual([])
  })

  it("issues an immutable signed 24-hour lease with seven-day grace and dependency closure", async () => {
    const fixture = await seed()
    const result = await issue(fixture)
    expect(result.version).toBe(1)
    const stored = await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)
    expect(stored?.envelopeJson).toBe(canonicalJson(stored?.envelope))
    const envelope = stored?.envelope as SignedEnvelope<EntitlementLease>
    await expect(verifyEnvelope(envelope, { "vendor-key-a": publicJwk }, fixture.deploymentId)).resolves.toEqual(envelope.payload)
    expect(envelope.payload).toMatchObject({
      schemaVersion: 2,
      clientId: fixture.clientId, deploymentId: fixture.deploymentId, keyId: "vendor-key-a", revision: 1,
      subscriptionStatus: "active", maxActiveUsers: 25,
      moduleIds: ["finance", "projects", "salesOrders"],
      contractStartsAt: "2026-08-01T00:00:00.000Z",
      contractEndsAt: "2027-01-01T00:00:00.000Z",
      issuedAt: now.toISOString(), leaseExpiresAt: "2026-08-11T12:00:00.000Z",
      graceUntil: "2026-08-18T12:00:00.000Z",
    })
    await expect(env.CONTROL_DB.prepare("UPDATE entitlement_versions SET signature = 'x' WHERE id = ?").bind(stored?.id).run()).rejects.toThrow(/immutable/)
    await expect(env.CONTROL_DB.prepare("DELETE FROM entitlement_versions WHERE id = ?").bind(stored?.id).run()).rejects.toThrow(/immutable/)
  })

  async function insertLegacyV1Entitlement(fixture: Awaited<ReturnType<typeof seed>>) {
    const payload = {
      schemaVersion: 1,
      keyId: "vendor-key-a",
      leaseId: "legacy-lease-001",
      clientId: fixture.clientId,
      deploymentId: fixture.deploymentId,
      issuedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
      contractStartsAt: "2026-08-01T00:00:00.000Z",
      contractEndsAt: "2027-01-01T00:00:00.000Z",
      graceUntil: new Date(now.getTime() + 8 * DAY_MS).toISOString(),
      subscriptionStatus: "active",
      planId: "plan-pro",
      maxActiveUsers: 25,
      moduleIds: ["finance", "projects", "salesOrders"],
      addonIds: [],
      configurationVersion: "config-1",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
      approvedImageDigest: `sha256:${"a".repeat(64)}`,
    }
    const envelope = await signEnvelope(payload, payload.keyId, privateJwk)
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at, issuance_key, envelope_json, contract_revision, schedule_revision, renewal_claim_token) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'legacy:v1', ?, 1, 1, NULL)",
      ).bind(crypto.randomUUID(), fixture.deploymentId, fixture.contractId, payload.keyId, canonicalJson(payload), envelope.signature, now.toISOString(), now.toISOString(), canonicalJson(envelope)),
      env.CONTROL_DB.prepare(
        "INSERT INTO deployment_entitlement_sequences (deployment_id, next_version) VALUES (?, 2)",
      ).bind(fixture.deploymentId),
      env.CONTROL_DB.prepare(
        "UPDATE deployment_entitlement_schedules SET latest_version = 1, next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
      ).bind(fixture.deploymentId),
    ])
    return envelope
  }

  it("retrieves immutable legacy schema-v1 history and promptly reissues its current pointer as v2", async () => {
    const fixture = await seed()
    const legacy = await insertLegacyV1Entitlement(fixture)

    expect(await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)).toMatchObject({
      envelopeJson: canonicalJson(legacy),
      envelope: legacy,
    })
    expect((await runEntitlementRenewal(bindings(), new Date(now.getTime() + 1))).issued).toBe(1)
    expect(await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)).toMatchObject({
      envelopeJson: canonicalJson(legacy),
      envelope: { payload: { schemaVersion: 1 } },
    })
    const current = await getCurrentEntitlementReference(env.CONTROL_DB, fixture.deploymentId)
    expect(current?.version).toBe(2)
    expect(await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 2)).toMatchObject({
      envelope: { payload: { schemaVersion: 2, revision: 2 } },
    })
  })

  it("allocates unique signed revisions, permits failed-allocation gaps, and keeps issuance/audit atomic", async () => {
    const fixture = await seed()
    const results = await Promise.all(Array.from({ length: 4 }, () => issue(fixture)))
    expect(results.map((result) => result.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(results.every((result) =>
      result.envelope.payload.schemaVersion === 2 && result.envelope.payload.revision === result.version)).toBe(true)

    const failing = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch([
          ...statements,
          target.prepare("INSERT INTO entitlement_versions (id) VALUES ('forced-failure')"),
        ])
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await expect(issue(fixture, now, bindings(failing))).rejects.toThrow()
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(4)
    const sequence = await env.CONTROL_DB.prepare("SELECT next_version FROM deployment_entitlement_sequences WHERE deployment_id = ?").bind(fixture.deploymentId).first<{ next_version: number }>()
    expect(sequence?.next_version).toBe(6)
  })

  it("aborts a stale signed issuance when controls change before its batch", async () => {
    const fixture = await seed({ status: "active" })
    let interleaved = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!interleaved) {
              interleaved = true
              await updateEntitlementControls(target, fixture.contractId, { status: "suspended" }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
            }
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })

    await expect(issue(fixture, now, bindings(database))).rejects.toMatchObject({
      status: 409,
      code: "entitlement_state_changed",
    })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.issue' AND target_id = ?", [fixture.deploymentId])).toBe(0)
    const state = await env.CONTROL_DB.prepare(
      "SELECT c.status, s.next_check_at FROM contracts c JOIN deployment_entitlement_schedules s ON s.contract_id = c.id WHERE c.id = ?",
    ).bind(fixture.contractId).first<{ status: string; next_check_at: string }>()
    expect(state).toEqual({ status: "suspended", next_check_at: now.toISOString() })
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("aborts automatic issuance when renewal claim ownership changes before commit", async () => {
    const fixture = await seed()
    const issuanceKey = "auto:0:claim-race"
    const createdAt = now.toISOString()
    await env.CONTROL_DB.prepare(
      "INSERT INTO entitlement_renewal_claims (deployment_id, issuance_key, claim_token, target_key_id, state, claim_expires_at, attempt_count, created_at, updated_at) VALUES (?, ?, 'original', 'vendor-key-a', 'claimed', ?, 1, ?, ?)",
    ).bind(fixture.deploymentId, issuanceKey, new Date(now.getTime() + 60_000).toISOString(), createdAt, createdAt).run()
    let intercepted = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true
              await target.prepare(
                "UPDATE entitlement_renewal_claims SET claim_token = 'reclaimed' WHERE deployment_id = ? AND issuance_key = ?",
              ).bind(fixture.deploymentId, issuanceKey).run()
            }
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await expect(issueEntitlement(bindings(database), {
      deploymentId: fixture.deploymentId,
      contractId: fixture.contractId,
      issuanceKey,
      claimToken: "original",
      actor: { operatorId: null, requestId: crypto.randomUUID(), source: "scheduled" },
      now,
    })).rejects.toMatchObject({ status: 409, code: "entitlement_state_changed" })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("fails closed for missing/malformed secrets and never persists private key material", async () => {
    const fixture = await seed()
    for (const secret of ["", "not-json", JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "bad" })]) {
      await expect(issue(fixture, now, bindings(env.CONTROL_DB, { ENTITLEMENT_SIGNING_PRIVATE_JWK: secret }))).rejects.toMatchObject({
        status: 503,
        code: "signing_configuration_unavailable",
      })
    }
    const dump = JSON.stringify((await env.CONTROL_DB.prepare("SELECT payload_json, envelope_json FROM entitlement_versions WHERE deployment_id = ?").bind(fixture.deploymentId).all()).results)
    expect(dump).not.toContain(privateJwk.d)
  })

  it("keeps old envelopes byte-identical after key rotation and rejects tampering/wrong keys", async () => {
    const fixture = await seed()
    await issue(fixture)
    const old = await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const rotatedPrivate = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const rotatedPublic = await crypto.subtle.exportKey("jwk", pair.publicKey)
    const rotated = bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-b",
      ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(rotatedPrivate),
    })
    await issue(fixture, new Date(now.getTime() + 1), rotated)
    expect((await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1))?.envelopeJson).toBe(old?.envelopeJson)
    const current = (await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 2))!.envelope
    await expect(verifyEnvelope(current, { "vendor-key-b": rotatedPublic }, fixture.deploymentId)).resolves.not.toBeNull()
    await expect(verifyEnvelope(current, { "vendor-key-b": publicJwk }, fixture.deploymentId)).resolves.toBeNull()
    const tampered = structuredClone(current)
    tampered.payload.maxActiveUsers += 1
    await expect(verifyEnvelope(tampered, { "vendor-key-b": rotatedPublic }, fixture.deploymentId)).resolves.toBeNull()
  })
})

describe("commercial controls and boundaries", () => {
  it("serializes parallel control changes and preserves both after explicit retry", async () => {
    const fixture = await seed()
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const database = () => new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            arrivals += 1
            if (arrivals === 2) release()
            await barrier
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const changes = [
      { renewalPolicy: "non_renewing" as const },
      { suspensionAt: "2026-08-12T00:00:00.000Z" },
    ]
    const results = await Promise.allSettled(changes.map((change) =>
      updateEntitlementControls(database(), fixture.contractId, change, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejectedIndex = results.findIndex((result) => result.status === "rejected")
    expect(rejectedIndex).toBeGreaterThanOrEqual(0)
    expect((results[rejectedIndex] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: "entitlement_state_changed",
    })
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, changes[rejectedIndex]!, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    const state = await env.CONTROL_DB.prepare(
      "SELECT c.renewal_policy, c.suspension_at, c.entitlement_revision, s.state_revision FROM contracts c JOIN deployment_entitlement_schedules s ON s.contract_id = c.id WHERE c.id = ?",
    ).bind(fixture.contractId).first<Record<string, string | number | null>>()
    expect(state).toMatchObject({
      renewal_policy: "non_renewing",
      suspension_at: "2026-08-12T00:00:00.000Z",
      entitlement_revision: 3,
      state_revision: 3,
    })
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.controls.update' AND target_id = ? AND outcome = 'success'", [fixture.contractId])).toBe(2)
  })

  it("keeps past_due write-allowed but suspends exactly at suspension_at", async () => {
    const fixture = await seed({ status: "past_due" })
    await expect(updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { suspensionAt: now.toISOString() }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toThrow()
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { suspensionAt: "2026-08-12T00:00:00.000Z" }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    const before = (await issue(fixture, new Date("2026-08-11T23:59:59.999Z"))).envelope.payload
    const exact = (await issue(fixture, new Date("2026-08-12T00:00:00.000Z"))).envelope.payload
    expect(before.subscriptionStatus).toBe("past_due")
    expect(evaluateLease(before, before.issuedAt).writeAllowed).toBe(true)
    expect(exact.subscriptionStatus).toBe("suspended")
    expect(evaluateLease(exact, exact.issuedAt).writeAllowed).toBe(false)
  })

  it("keeps non-renewing active until end-exclusive then cancels", async () => {
    const fixture = await seed({ endsAt: "2026-08-10" })
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { renewalPolicy: "non_renewing" }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    const before = (await issue(fixture, new Date("2026-08-10T23:59:59.999Z"))).envelope.payload
    const exact = (await issue(fixture, new Date("2026-08-11T00:00:00.000Z"))).envelope.payload
    expect(before.subscriptionStatus).toBe("active")
    expect(exact.subscriptionStatus).toBe("cancelled")
  })

  it("records immediate suspension as effective contract state", async () => {
    const fixture = await seed({ status: "past_due" })
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { status: "suspended" }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    const payload = (await issue(fixture)).envelope.payload
    expect(payload.subscriptionStatus).toBe("suspended")
    expect(evaluateLease(payload, payload.issuedAt).writeAllowed).toBe(false)
  })

  it("requires fresh healthy server-observed usage for immediate reductions and accepts future reductions", async () => {
    const fixture = await seed({ seatLimit: 25 })
    const actor = { operatorId: ownerId, requestId: crypto.randomUUID() }
    await expect(updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 20 }, actor, now)).rejects.toThrow()
    await env.CONTROL_DB.prepare("INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, active_user_count, reserved_invitation_count, created_at) VALUES (?, ?, ?, 20, '1.0.0', 'healthy', 18, 2, ?)")
      .bind(crypto.randomUUID(), fixture.deploymentId, now.toISOString(), now.toISOString()).run()
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 20 }, actor, now)
    await expect(updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 19 }, actor, now)).rejects.toThrow()
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 10, effectiveAt: "2026-08-11T00:00:00.000Z" }, actor, now)
    expect((await issue(fixture, new Date("2026-08-10T23:59:59.999Z"))).envelope.payload.maxActiveUsers).toBe(20)
    expect((await issue(fixture, new Date("2026-08-11T00:00:00.000Z"))).envelope.payload.maxActiveUsers).toBe(10)
  })

  it("rejects stale/unhealthy/future usage and inactive, unknown, or cyclic dependency catalogs without history", async () => {
    for (const observedAt of ["2026-08-10T11:29:59.999Z", "2026-08-10T12:00:00.001Z"] as const) {
      const fixture = await seed()
      await env.CONTROL_DB.prepare("INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, active_user_count, reserved_invitation_count, created_at) VALUES (?, ?, ?, 1, '1.0.0', 'healthy', 1, 0, ?)")
        .bind(crypto.randomUUID(), fixture.deploymentId, observedAt, observedAt).run()
      await expect(updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 1 }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toThrow()
    }
    for (const corrupt of [
      "UPDATE module_catalog SET active = 0 WHERE module_id = 'projects'",
      "UPDATE module_catalog SET dependency_ids_json = '[\"unknown\"]' WHERE module_id = 'projects'",
      "UPDATE module_catalog SET dependency_ids_json = '[\"salesOrders\"]' WHERE module_id = 'projects'",
    ]) {
      const fixture = await seed()
      await env.CONTROL_DB.prepare(corrupt).run()
      await expect(issue(fixture)).rejects.toThrow()
      expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
      await env.CONTROL_DB.prepare("UPDATE module_catalog SET active = 1, dependency_ids_json = '[]' WHERE module_id = 'projects'").run()
    }
  })
})

describe("scheduler and retrieval", () => {
  it("never automatically first-signs a scheduled deployment", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()

    const summary = await runEntitlementRenewal(bindings(), now)

    expect(summary.skipped).toBeGreaterThanOrEqual(1)
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
  })

  it.each([
    {
      label: "contract controls",
      change: (fixture: Awaited<ReturnType<typeof seed>>) => updateEntitlementControls(
        env.CONTROL_DB,
        fixture.contractId,
        { renewalPolicy: "non_renewing" },
        { operatorId: ownerId, requestId: crypto.randomUUID() },
        new Date(now.getTime() + 1),
      ),
    },
    {
      label: "schedule controls",
      change: (fixture: Awaited<ReturnType<typeof seed>>) => assignEntitlementSchedule(env.CONTROL_DB, {
        deploymentId: fixture.deploymentId,
        contractId: fixture.contractId,
        configurationVersion: "config-reviewed-again",
        releaseChannel: "beta",
        minimumSupportedAppVersion: "2.0.0",
      }, { operatorId: ownerId, requestId: crypto.randomUUID() }, new Date(now.getTime() + 1)),
    },
  ])("requires manual review after $label change", async ({ change }) => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    await change(fixture)

    const automatic = await runEntitlementRenewal(bindings(), new Date(now.getTime() + 2))

    expect(automatic).toMatchObject({ checked: 1, issued: 0, skipped: 1, failed: 0 })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(1)
    const manuallyIssued = await issue(fixture, new Date(now.getTime() + 3))
    expect(manuallyIssued.version).toBe(2)
  })

  it.each([
    {
      label: "client becomes disabled",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>, target: D1Database) => target.prepare(
        "UPDATE clients SET status = 'disabled' WHERE id = ?",
      ).bind(fixture.clientId).run(),
    },
    {
      label: "deployment becomes disabled",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>, target: D1Database) => target.prepare(
        "UPDATE deployments SET status = 'disabled' WHERE id = ?",
      ).bind(fixture.deploymentId).run(),
    },
    {
      label: "registration disappears",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>, target: D1Database) => target.prepare(
        "UPDATE deployments SET registered_at = NULL, registration_key_fingerprint = NULL WHERE id = ?",
      ).bind(fixture.deploymentId).run(),
    },
    {
      label: "eligible deployment key is revoked",
      invalidate: (fixture: Awaited<ReturnType<typeof seed>>, target: D1Database) => target.prepare(
        "UPDATE deployment_keys SET revoked_at = ? WHERE deployment_id = ?",
      ).bind(now.toISOString(), fixture.deploymentId).run(),
    },
  ])("atomically rejects issuance when $label before final insert", async ({ invalidate }) => {
    const fixture = await seed()
    let intercepted = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true
              await invalidate(fixture, target)
            }
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })

    await expect(issue(fixture, now, bindings(database))).rejects.toMatchObject({
      status: 409,
      code: "entitlement_prerequisites_unavailable",
    })
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.issue' AND target_id = ?", [fixture.deploymentId])).toBe(0)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).run()
  })

  it("renews an explicitly issued entitlement at the six-hour horizon and is idempotent", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)

    expect((await runEntitlementRenewal(bindings(), new Date(now.getTime() + 1))).issued).toBe(0)
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id = ?").bind("2026-08-11T06:00:00.000Z", fixture.deploymentId).run()
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-11T05:59:59.999Z"))).issued).toBe(0)
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-11T06:00:00.000Z"))).issued).toBe(1)
    const rows = await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])
    expect(rows).toBe(2)
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.renew' AND target_id = ?", [fixture.deploymentId])).toBe(1)
  })

  it.each(["schedule", "contract"] as const)(
    "rejects automatic issuance when the reviewed %s revision changes after the renewal claim",
    async (changedRevision) => {
      await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
      const fixture = await seed()
      await issue(fixture)
      const renewalAt = new Date(now.getTime() + 18 * 60 * 60 * 1_000)
      let interleaved = false
      const database = new Proxy(env.CONTROL_DB, {
        get(target, property) {
          if (property === "prepare") {
            return (sql: string) => {
              const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
                get(prepared, statementProperty) {
                  if (statementProperty === "bind") return (...values: unknown[]) => wrap(prepared.bind(...values))
                  if (statementProperty === "first" && sql.includes("WHERE deployment_id = ? AND issuance_key = ?")) {
                    return async () => {
                      const row = await prepared.first()
                      if (!interleaved) {
                        interleaved = true
                        if (changedRevision === "schedule") {
                          await target.prepare(
                            "UPDATE deployment_entitlement_schedules SET configuration_version = 'interleaved-config', state_revision = state_revision + 1 WHERE deployment_id = ?",
                          ).bind(fixture.deploymentId).run()
                        } else {
                          await target.prepare(
                            "UPDATE contracts SET seat_limit = seat_limit + 1, entitlement_revision = entitlement_revision + 1 WHERE id = ?",
                          ).bind(fixture.contractId).run()
                        }
                      }
                      return row
                    }
                  }
                  const value = Reflect.get(prepared, statementProperty, prepared)
                  return typeof value === "function" ? value.bind(prepared) : value
                },
              })
              return wrap(target.prepare(sql))
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })

      await expect(runEntitlementRenewal(bindings(database), renewalAt)).resolves.toMatchObject({
        issued: 0,
        failed: 1,
      })
      expect(interleaved).toBe(true)
      expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(1)
      await expect(env.CONTROL_DB.prepare(
        "SELECT state, last_error_code FROM entitlement_renewal_claims WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 1",
      ).bind(fixture.deploymentId).first()).resolves.toEqual({
        state: "failed",
        last_error_code: "entitlement_state_changed",
      })
      await env.CONTROL_DB.prepare(
        "UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
      ).bind(fixture.deploymentId).run()
    },
  )

  it("reclaims expired claims without duplicate issuance", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    const renewalAt = new Date(now.getTime() + 18 * 60 * 60 * 1_000)
    const failing = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch([
          ...statements,
          target.prepare("INSERT INTO entitlement_versions (id) VALUES ('forced-claim-failure')"),
        ])
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect((await runEntitlementRenewal(bindings(failing), renewalAt)).failed).toBe(1)
    const claim = await env.CONTROL_DB.prepare("SELECT issuance_key FROM entitlement_renewal_claims WHERE deployment_id = ?")
      .bind(fixture.deploymentId).first<{ issuance_key: string }>()
    expect(claim?.issuance_key).toMatch(/^auto:1:/)
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("UPDATE entitlement_renewal_claims SET state = 'claimed', claim_token = 'dead', claim_expires_at = ?, retry_at = NULL WHERE deployment_id = ? AND issuance_key = ?")
        .bind(new Date(renewalAt.getTime() - 1).toISOString(), fixture.deploymentId, claim!.issuance_key),
      env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id = ?")
        .bind(renewalAt.toISOString(), fixture.deploymentId),
    ])
    const summaries = await Promise.all([runEntitlementRenewal(bindings(), renewalAt), runEntitlementRenewal(bindings(), renewalAt)])
    expect(summaries.reduce((sum, item) => sum + item.issued, 0)).toBe(1)
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(2)
  })

  it("does not let an expired worker fail a replacement renewal claim", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    const renewalAt = new Date(now.getTime() + 18 * 60 * 60 * 1_000)
    let reclaimed = false
    const staleWorker = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!reclaimed) {
              reclaimed = true
              const claim = await target.prepare(
                "SELECT issuance_key FROM entitlement_renewal_claims WHERE deployment_id = ? AND state = 'claimed'",
              ).bind(fixture.deploymentId).first<{ issuance_key: string }>()
              await target.prepare(
                "UPDATE entitlement_renewal_claims SET claim_token = 'replacement-worker', claim_expires_at = ?, attempt_count = attempt_count + 1 WHERE deployment_id = ? AND issuance_key = ?",
              ).bind(new Date(renewalAt.getTime() + 10 * 60_000).toISOString(), fixture.deploymentId, claim!.issuance_key).run()
            }
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect((await runEntitlementRenewal(bindings(staleWorker), renewalAt)).failed).toBe(1)
    const claim = await env.CONTROL_DB.prepare(
      "SELECT claim_token, state, retry_at, last_error_code FROM entitlement_renewal_claims WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<{ claim_token: string; state: string; retry_at: string | null; last_error_code: string | null }>()
    expect(claim).toEqual({
      claim_token: "replacement-worker",
      state: "claimed",
      retry_at: null,
      last_error_code: null,
    })
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("does not overwrite a reassigned contract schedule after a pre-claim catalog failure", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id = ?",
    ).bind(now.toISOString(), fixture.deploymentId).run()
    const replacementContractId = crypto.randomUUID()
    await env.CONTROL_DB.prepare(
      "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) SELECT ?, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at FROM contracts WHERE id = ?",
    ).bind(replacementContractId, fixture.contractId).run()
    await env.CONTROL_DB.prepare("UPDATE module_catalog SET dependency_ids_json = '[\"unknown\"]' WHERE module_id = 'projects'").run()
    let reassigned = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
              get(prepared, statementProperty) {
                if (statementProperty === "bind") return (...values: unknown[]) => wrap(prepared.bind(...values))
                if (statementProperty === "all" && sql.startsWith("SELECT cm.module_id")) {
                  return async () => {
                    const rows = await prepared.all()
                    if (!reassigned) {
                      reassigned = true
                      await target.prepare(
                        "UPDATE deployment_entitlement_schedules SET contract_id = ?, state_revision = state_revision + 1, next_check_at = ?, updated_at = ? WHERE deployment_id = ?",
                      ).bind(replacementContractId, now.toISOString(), now.toISOString(), fixture.deploymentId).run()
                    }
                    return rows
                  }
                }
                const value = Reflect.get(prepared, statementProperty, prepared)
                return typeof value === "function" ? value.bind(prepared) : value
              },
            })
            return wrap(target.prepare(sql))
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect((await runEntitlementRenewal(bindings(database), now)).failed).toBe(1)
    const reassignedSchedule = await env.CONTROL_DB.prepare(
      "SELECT contract_id, next_check_at FROM deployment_entitlement_schedules WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first()
    await env.CONTROL_DB.prepare("UPDATE module_catalog SET dependency_ids_json = '[]' WHERE module_id = 'projects'").run()
    expect(reassignedSchedule).toEqual({ contract_id: replacementContractId, next_check_at: now.toISOString() })
  })

  it("does not overwrite a registration wake after an unavailable snapshot", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("UPDATE deployments SET status = 'pending', registered_at = NULL, registration_key_fingerprint = NULL WHERE id = ?").bind(fixture.deploymentId),
      env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id = ?").bind(now.toISOString(), fixture.deploymentId),
    ])
    let registered = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
              get(prepared, statementProperty) {
                if (statementProperty === "bind") return (...values: unknown[]) => wrap(prepared.bind(...values))
                if (statementProperty === "first" && sql.startsWith("SELECT d.id AS deployment_id")) {
                  return async () => {
                    const row = await prepared.first()
                    if (!registered) {
                      registered = true
                      await target.batch([
                        target.prepare("UPDATE deployments SET status = 'active', registered_at = ?, registration_key_fingerprint = 'registered-again' WHERE id = ?").bind(now.toISOString(), fixture.deploymentId),
                        target.prepare("UPDATE deployment_entitlement_schedules SET state_revision = state_revision + 1, next_check_at = ?, updated_at = ? WHERE deployment_id = ?").bind(now.toISOString(), now.toISOString(), fixture.deploymentId),
                      ])
                    }
                    return row
                  }
                }
                const value = Reflect.get(prepared, statementProperty, prepared)
                return typeof value === "function" ? value.bind(prepared) : value
              },
            })
            return wrap(target.prepare(sql))
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect((await runEntitlementRenewal(bindings(database), now)).skipped).toBe(1)
    expect(await env.CONTROL_DB.prepare(
      "SELECT d.status, d.registered_at, s.next_check_at FROM deployments d JOIN deployment_entitlement_schedules s ON s.deployment_id = d.id WHERE d.id = ?",
    ).bind(fixture.deploymentId).first()).toEqual({ status: "active", registered_at: now.toISOString(), next_check_at: now.toISOString() })
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("renews immediately when active signing key changes even before next_check_at", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const rotatedPrivate = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const rotated = bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-b",
      ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(rotatedPrivate),
    })
    const summary = await runEntitlementRenewal(rotated, new Date(now.getTime() + 1))
    expect(summary.issued).toBeGreaterThanOrEqual(1)
    expect((await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 2))?.keyId).toBe("vendor-key-b")
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.renew' AND target_id = ?", [fixture.deploymentId])).toBe(1)
    await runEntitlementRenewal(bindings(), new Date(now.getTime() + 2))
  })

  it("requires manual issuance at a future suspension boundary after controls change", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await issue(fixture)
    const boundary = "2026-08-10T13:00:00.000Z"
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { suspensionAt: boundary }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    await assignEntitlementSchedule(env.CONTROL_DB, {
      deploymentId: fixture.deploymentId,
      contractId: fixture.contractId,
      configurationVersion: "config-suspension",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
      approvedImageDigest: `sha256:${"a".repeat(64)}`,
    }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    expect((await runEntitlementRenewal(bindings(env.CONTROL_DB, { ENTITLEMENT_SIGNING_PRIVATE_JWK: "" }), now)).skipped).toBeGreaterThanOrEqual(1)
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-10T12:59:59.999Z"))).checked).toBe(0)
    expect((await runEntitlementRenewal(bindings(), new Date(boundary))).issued).toBe(0)
    expect((await issue(fixture, new Date(boundary))).envelope.payload.subscriptionStatus).toBe("suspended")
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("requires manual issuance at a future seat-reduction boundary after controls change", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed({ seatLimit: 25 })
    await issue(fixture)
    const boundary = "2026-08-10T14:00:00.000Z"
    await updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 10, effectiveAt: boundary }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    await assignEntitlementSchedule(env.CONTROL_DB, {
      deploymentId: fixture.deploymentId,
      contractId: fixture.contractId,
      configurationVersion: "config-seat-reduction",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
      approvedImageDigest: `sha256:${"a".repeat(64)}`,
    }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)
    expect((await runEntitlementRenewal(bindings(env.CONTROL_DB, { ENTITLEMENT_SIGNING_PRIVATE_JWK: "" }), now)).skipped).toBeGreaterThanOrEqual(1)
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-10T13:59:59.999Z"))).checked).toBe(0)
    expect((await runEntitlementRenewal(bindings(), new Date(boundary))).issued).toBe(0)
    expect((await issue(fixture, new Date(boundary))).envelope.payload.maxActiveUsers).toBe(10)
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
  })

  it("backs off failed key rotations without starving untouched mismatches", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    await env.CONTROL_DB.prepare("UPDATE contracts SET ends_at = '2026-12-31', suspension_at = NULL, scheduled_seat_limit = NULL, seat_limit_effective_at = NULL").run()
    const current = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_entitlement_schedules s JOIN contracts c ON c.id = s.contract_id JOIN entitlement_versions e ON e.id = (SELECT current.id FROM entitlement_versions current WHERE current.deployment_id = s.deployment_id ORDER BY current.version DESC LIMIT 1) WHERE e.key_id = 'vendor-key-a' AND e.contract_id = s.contract_id AND e.contract_revision = c.entitlement_revision AND e.schedule_revision = s.state_revision",
    ).first<{ count: number }>()
    for (let index = current?.count ?? 0; index < 52; index += 1) {
      const fixture = await seed()
      await issue(fixture)
      await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(fixture.deploymentId).run()
    }
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const correctedPrivate = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const failedRotation = bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-c",
      ENTITLEMENT_SIGNING_PRIVATE_JWK: "",
    })
    expect(await runEntitlementRenewal(failedRotation, now)).toMatchObject({ checked: 50, failed: 50, issued: 0 })
    expect(await runEntitlementRenewal(failedRotation, new Date(now.getTime() + 1))).toMatchObject({ checked: 2, failed: 2, issued: 0 })
    const failedContracts = await env.CONTROL_DB.prepare(
      "SELECT s.contract_id FROM entitlement_renewal_claims r JOIN deployment_entitlement_schedules s ON s.deployment_id = r.deployment_id WHERE r.target_key_id = 'vendor-key-c' AND r.state = 'failed' ORDER BY s.contract_id",
    ).all<{ contract_id: string }>()
    expect(failedContracts.results).toHaveLength(52)
    for (const row of failedContracts.results) {
      await updateEntitlementControls(env.CONTROL_DB, row.contract_id, { renewalPolicy: "non_renewing" }, { operatorId: ownerId, requestId: crypto.randomUUID() }, new Date(now.getTime() + 2))
    }
    const untouched = await seed()
    await issue(untouched, new Date(now.getTime() + 2))

    const correctedRotation = bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-c",
      ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(correctedPrivate),
    })
    const corrected = [
      await runEntitlementRenewal(correctedRotation, new Date(now.getTime() + 3)),
      await runEntitlementRenewal(correctedRotation, new Date(now.getTime() + 4)),
    ]
    expect(corrected.reduce((total, item) => total + item.checked, 0)).toBe(53)
    expect(corrected.reduce((total, item) => total + item.issued, 0)).toBe(1)
    expect(corrected.reduce((total, item) => total + item.skipped, 0)).toBe(52)
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?").bind(untouched.deploymentId).run()
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [untouched.deploymentId])).toBe(2)
  }, 30000)

  it("advances invalid schedules and backs off failed signing without persisting a lease", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const disabled = await seed()
    await issue(disabled)
    await env.CONTROL_DB.prepare("UPDATE deployments SET status = 'disabled' WHERE id = ?").bind(disabled.deploymentId).run()
    const missingSecret = await seed()
    await issue(missingSecret)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id IN (?, ?)",
    ).bind(now.toISOString(), disabled.deploymentId, missingSecret.deploymentId).run()
    const summary = await runEntitlementRenewal(bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-unavailable",
      ENTITLEMENT_SIGNING_PRIVATE_JWK: "",
    }), now)
    expect(summary.issued).toBe(0)
    expect(summary.failed).toBeGreaterThanOrEqual(1)
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
    for (const fixture of [disabled, missingSecret]) {
      const schedule = await env.CONTROL_DB.prepare("SELECT next_check_at FROM deployment_entitlement_schedules WHERE deployment_id = ?")
        .bind(fixture.deploymentId).first<{ next_check_at: string }>()
      expect(Date.parse(schedule!.next_check_at)).toBeGreaterThan(now.getTime())
      expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(1)
    }
    const claim = await env.CONTROL_DB.prepare("SELECT state, retry_at, last_error_code FROM entitlement_renewal_claims WHERE deployment_id = ?")
      .bind(missingSecret.deploymentId).first<{ state: string; retry_at: string; last_error_code: string }>()
    expect(claim).toMatchObject({ state: "failed", last_error_code: "signing_configuration_invalid" })
    expect(Date.parse(claim!.retry_at)).toBe(now.getTime() + DAY_MS)
  })

  it("serves exact authenticated stored bytes with no-store and ETag", async () => {
    const fixture = await seed()
    await issue(fixture)
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const keyId = crypto.randomUUID()
    const key = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
    const createdAt = new Date(Date.now() - 1_000).toISOString()
    await env.CONTROL_DB.prepare("INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', ?, ?, ?, NULL, NULL, NULL, NULL, ?)")
      .bind(crypto.randomUUID(), fixture.deploymentId, keyId, JSON.stringify({ kty: "OKP", crv: "Ed25519", x: key.x }), await publicKeyFingerprint(key.x!), createdAt, createdAt).run()
    const path = `/v1/deployments/${fixture.deploymentId}/entitlement/1`
    const timestamp = new Date().toISOString()
    const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
    const digest = lowercaseHex(await sha256(new Uint8Array()))
    const transcript = deploymentRequestTranscript({ method: "GET", path, deploymentId: fixture.deploymentId, keyId, timestamp, nonce, bodyDigestHex: digest })
    const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, transcript)
    const headers = {
      "X-Deployment-Key-Id": keyId, "X-Deployment-Timestamp": timestamp,
      "X-Deployment-Nonce": nonce, "X-Deployment-Signature": toBase64Url(new Uint8Array(signature)),
    }
    const response = await createApp().fetch(new Request(`https://control.invalid${path}`, { headers }), bindings())
    const stored = await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(stored?.envelopeJson)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("ETag")).toMatch(/^"[A-Za-z0-9_-]{43}"$/)
    const replay = await createApp().fetch(new Request(`https://control.invalid${path}`, { headers }), bindings())
    expect(replay.status).toBe(401)

    const other = await seed()
    await issue(other)
    const otherPath = `/v1/deployments/${other.deploymentId}/entitlement/1`
    const otherNonce = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
    const otherTranscript = deploymentRequestTranscript({ method: "GET", path: otherPath, deploymentId: other.deploymentId, keyId, timestamp, nonce: otherNonce, bodyDigestHex: digest })
    const otherSignature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, otherTranscript)
    const wrongDeployment = await createApp().fetch(new Request(`https://control.invalid${otherPath}`, { headers: {
      "X-Deployment-Key-Id": keyId, "X-Deployment-Timestamp": timestamp,
      "X-Deployment-Nonce": otherNonce, "X-Deployment-Signature": toBase64Url(new Uint8Array(otherSignature)),
    } }), bindings())
    expect(wrongDeployment.status).toBe(401)
  })
})
