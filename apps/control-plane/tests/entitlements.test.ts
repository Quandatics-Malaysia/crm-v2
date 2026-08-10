import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { canonicalJson, evaluateLease, verifyEnvelope, type EntitlementLease, type SignedEnvelope } from "@crm/control-protocol"
import { createApp } from "../src/index"
import { publicKeyFingerprint } from "../src/auth/deployment"
import {
  assignEntitlementSchedule,
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
  it("issues an immutable signed 24-hour lease with seven-day grace and dependency closure", async () => {
    const fixture = await seed()
    const result = await issue(fixture)
    expect(result.version).toBe(1)
    const stored = await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)
    expect(stored?.envelopeJson).toBe(canonicalJson(stored?.envelope))
    const envelope = stored?.envelope as SignedEnvelope<EntitlementLease>
    await expect(verifyEnvelope(envelope, { "vendor-key-a": publicJwk }, fixture.deploymentId)).resolves.toEqual(envelope.payload)
    expect(envelope.payload).toMatchObject({
      clientId: fixture.clientId, deploymentId: fixture.deploymentId, keyId: "vendor-key-a",
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

  it("allocates unique contiguous versions and makes issuance/audit rollback atomic", async () => {
    const fixture = await seed()
    const results = await Promise.all(Array.from({ length: 4 }, () => issue(fixture)))
    expect(results.map((result) => result.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])

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
    expect(sequence?.next_version).toBe(5)
  })

  it("fails closed for missing/malformed secrets and never persists private key material", async () => {
    const fixture = await seed()
    for (const secret of ["", "not-json", JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "bad" })]) {
      await expect(issue(fixture, now, bindings(env.CONTROL_DB, { ENTITLEMENT_SIGNING_PRIVATE_JWK: secret }))).rejects.toThrow()
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

  it("rejects stale/unhealthy/future usage and invalid dependency catalogs without history", async () => {
    for (const observedAt of ["2026-08-10T11:29:59.999Z", "2026-08-10T12:00:00.001Z"] as const) {
      const fixture = await seed()
      await env.CONTROL_DB.prepare("INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, active_user_count, reserved_invitation_count, created_at) VALUES (?, ?, ?, 1, '1.0.0', 'healthy', 1, 0, ?)")
        .bind(crypto.randomUUID(), fixture.deploymentId, observedAt, observedAt).run()
      await expect(updateEntitlementControls(env.CONTROL_DB, fixture.contractId, { seatLimit: 1 }, { operatorId: ownerId, requestId: crypto.randomUUID() }, now)).rejects.toThrow()
    }
    const fixture = await seed()
    await env.CONTROL_DB.prepare("UPDATE module_catalog SET dependency_ids_json = '[\"documentation\"]' WHERE module_id = 'projects'").run()
    await expect(issue(fixture)).rejects.toThrow()
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
    await env.CONTROL_DB.prepare("UPDATE module_catalog SET dependency_ids_json = '[]' WHERE module_id = 'projects'").run()
  })
})

describe("scheduler and retrieval", () => {
  it("renews only when missing, within six hours, or desired inputs change and is idempotent", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    const first = await runEntitlementRenewal(bindings(), now)
    expect(first).toMatchObject({ issued: 1 })
    expect((await runEntitlementRenewal(bindings(), new Date(now.getTime() + 1))).issued).toBe(0)
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = ? WHERE deployment_id = ?").bind("2026-08-11T06:00:00.000Z", fixture.deploymentId).run()
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-11T05:59:59.999Z"))).issued).toBe(0)
    expect((await runEntitlementRenewal(bindings(), new Date("2026-08-11T06:00:00.000Z"))).issued).toBe(1)
    const rows = await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])
    expect(rows).toBe(2)
    expect(await count("operator_audit_log", "WHERE action = 'entitlement.renew' AND target_id = ?", [fixture.deploymentId])).toBe(2)
  })

  it("reclaims expired claims without duplicate issuance", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const fixture = await seed()
    await env.CONTROL_DB.prepare("INSERT INTO entitlement_renewal_claims (deployment_id, issuance_key, claim_token, state, claim_expires_at, attempt_count, retry_at, created_at, updated_at) VALUES (?, 'auto:0:stale', 'dead', 'claimed', ?, 1, NULL, ?, ?)")
      .bind(fixture.deploymentId, new Date(now.getTime() - 1).toISOString(), now.toISOString(), now.toISOString()).run()
    const summaries = await Promise.all([runEntitlementRenewal(bindings(), now), runEntitlementRenewal(bindings(), now)])
    expect(summaries.reduce((sum, item) => sum + item.issued, 0)).toBe(1)
    expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(1)
  })

  it("advances invalid schedules and backs off failed signing without persisting a lease", async () => {
    await env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET next_check_at = '2099-01-01T00:00:00.000Z'").run()
    const disabled = await seed()
    await env.CONTROL_DB.prepare("UPDATE deployments SET status = 'disabled' WHERE id = ?").bind(disabled.deploymentId).run()
    const missingSecret = await seed()
    const summary = await runEntitlementRenewal(bindings(env.CONTROL_DB, {
      ENTITLEMENT_SIGNING_PRIVATE_JWK: "",
    }), now)
    expect(summary).toMatchObject({ checked: 2, issued: 0, skipped: 1, failed: 1 })
    for (const fixture of [disabled, missingSecret]) {
      const schedule = await env.CONTROL_DB.prepare("SELECT next_check_at FROM deployment_entitlement_schedules WHERE deployment_id = ?")
        .bind(fixture.deploymentId).first<{ next_check_at: string }>()
      expect(Date.parse(schedule!.next_check_at)).toBeGreaterThan(now.getTime())
      expect(await count("entitlement_versions", "WHERE deployment_id = ?", [fixture.deploymentId])).toBe(0)
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
    const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
    const nonce = base64(crypto.getRandomValues(new Uint8Array(32)))
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array()))].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    const transcript = new TextEncoder().encode(`crm-deployment-request-v1\nGET\n${path}\n${fixture.deploymentId}\n${keyId}\n${timestamp}\n${nonce}\nsha-256=${digest}\n`)
    const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, transcript)
    const response = await createApp().fetch(new Request(`https://control.invalid${path}`, { headers: {
      "X-Deployment-Key-Id": keyId, "X-Deployment-Timestamp": timestamp,
      "X-Deployment-Nonce": nonce, "X-Deployment-Signature": base64(new Uint8Array(signature)),
    } }), bindings())
    const stored = await getEntitlement(env.CONTROL_DB, fixture.deploymentId, 1)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(stored?.envelopeJson)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("ETag")).toMatch(/^"[A-Za-z0-9_-]{43}"$/)
  })
})
