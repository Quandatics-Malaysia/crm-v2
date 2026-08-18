import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it, vi } from "vitest"

import { AccessTokenInvalidError, type AccessVerifier } from "../src/auth/access"
import { OPERATOR_ROLES, type OperatorRole } from "../src/auth/rbac"
import { hashAuditRequestId } from "../src/audit"
import { createApp } from "../src/index"
import { getClientDetail, parseClientChildPagination } from "../src/repos/clients"
import { issueInstallToken } from "../src/repos/deployments"
import { getDeploymentWorkspace } from "../src/repos/onboarding"

const NOW = new Date("2026-08-10T12:00:00.000Z")
const HOUR_MS = 60 * 60 * 1_000
const REGISTRATION_FINGERPRINT = "f".repeat(43)
let signingPrivateJwk: JsonWebKey
const roleSubjects = new Map<string, { email: string; role: OperatorRole }>()
for (const role of OPERATOR_ROLES) {
  const subject = `${role}-${crypto.randomUUID()}`
  roleSubjects.set(`token-${role}`, { email: `${role}@example.com`, role })
  roleSubjects.set(subject, { email: `${role}@example.com`, role })
}

const accessVerifier: AccessVerifier = async (token) => {
  const identity = roleSubjects.get(token)
  if (!identity) throw new AccessTokenInvalidError()
  return { subject: token, email: identity.email }
}

const app = createApp({ accessVerifier })

interface Fixture {
  clientId: string
  deploymentId: string
  contractId: string
}

function bindings(overrides: Partial<CloudflareBindings> = {}): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: env.CONTROL_DB,
    ENVIRONMENT: "test",
    BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
    OPERATOR_ORIGIN: "https://control.invalid",
    ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-route-test",
    ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(signingPrivateJwk),
    ...overrides,
  } as unknown as CloudflareBindings
}

function workspaceRequest(deploymentId: string, token = "token-vendor_owner") {
  return app.fetch(
    new Request(`https://control.invalid/operator/deployments/${deploymentId}`, {
      headers: token ? { "Cf-Access-Jwt-Assertion": token } : undefined,
    }),
    bindings(),
  )
}

function issueInstallTokenRequest(
  deploymentId: string,
  options: { accept?: string; cfRay?: string; expiresAt?: string; idempotencyKey?: string; pepper?: string; requestId?: string; token?: string } = {},
) {
  const form = new URLSearchParams({
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1_000).toISOString().slice(0, 16),
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
  })
  return app.fetch(
    new Request(`https://control.invalid/operator/deployments/${deploymentId}/install-tokens`, {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": options.token ?? "token-vendor_owner",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://control.invalid",
        "Sec-Fetch-Site": "same-origin",
        ...(options.accept === undefined ? {} : { Accept: options.accept }),
        ...(options.cfRay === undefined ? {} : { "Cf-Ray": options.cfRay }),
        ...(options.requestId === undefined ? {} : { "X-Request-Id": options.requestId }),
      },
      body: form,
    }),
    bindings(options.pepper === undefined ? {} : { INSTALL_TOKEN_PEPPER: options.pepper }),
  )
}

function scheduleRequest(
  deploymentId: string,
  contractId: string,
  overrides: Record<string, string> = {},
  options: { accept?: string; token?: string } = {},
) {
  const form = new URLSearchParams({
    contractId,
    configurationVersion: "configuration-route-1",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "2.3.0",
    approvedImageDigest: `sha256:${"a".repeat(64)}`,
    ...overrides,
  })
  return app.fetch(new Request(`https://control.invalid/operator/deployments/${deploymentId}/entitlements/schedule`, {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": options.token ?? "token-vendor_owner",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://control.invalid",
      "Sec-Fetch-Site": "same-origin",
      ...(options.accept === undefined ? {} : { Accept: options.accept }),
    },
    body: form,
  }), bindings())
}

function reviewRequest(deploymentId: string) {
  return app.fetch(new Request(`https://control.invalid/operator/deployments/${deploymentId}/entitlements/review`, {
    headers: { "Cf-Access-Jwt-Assertion": "token-vendor_owner" },
  }), bindings())
}

function signingRequest(
  deploymentId: string,
  data: Record<string, string>,
  format: "html" | "json" = "html",
  options: { accept?: string; bindings?: Partial<CloudflareBindings>; token?: string } = {},
) {
  const json = format === "json"
  return app.fetch(new Request(`https://control.invalid/operator/deployments/${deploymentId}/entitlements/issue`, {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": options.token ?? "token-vendor_owner",
      "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded",
      Origin: "https://control.invalid",
      "Sec-Fetch-Site": "same-origin",
      ...(json ? { "X-Control-Request": "same-origin" } : {}),
      ...(options.accept === undefined ? {} : { Accept: options.accept }),
    },
    body: json ? JSON.stringify(data) : new URLSearchParams(data),
  }), bindings(options.bindings))
}

async function fixture(): Promise<Fixture> {
  const clientId = crypto.randomUUID()
  const deploymentId = crypto.randomUUID()
  const contractId = crypto.randomUUID()
  const createdAt = NOW.toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT OR IGNORE INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('onboarding-plan', 'onboarding', 'Onboarding', 1, ?, ?)",
    ).bind(createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Client', 'active', ?, ?)",
    ).bind(clientId, `client-${clientId}`, createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, ?, 'production', 'active', ?, ?)",
    ).bind(deploymentId, clientId, `deployment-${deploymentId}`, createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'onboarding-plan', 'active', '2026-08-01', '2026-08-31', 25, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)",
    ).bind(contractId, clientId, createdAt, createdAt),
  ])
  return { clientId, deploymentId, contractId }
}

async function registerDeployment(deploymentId: string) {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "UPDATE deployments SET registered_at = ?, registration_key_fingerprint = ? WHERE id = ?",
    ).bind(NOW.toISOString(), REGISTRATION_FINGERPRINT, deploymentId),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', '{}', ?, ?, NULL, NULL, NULL, NULL, ?)",
    ).bind(crypto.randomUUID(), deploymentId, crypto.randomUUID(), REGISTRATION_FINGERPRINT, "2026-08-01T00:00:00.000Z", NOW.toISOString()),
  ])
}

async function assignSchedule(input: Fixture) {
  await env.CONTROL_DB.prepare(
    "INSERT INTO deployment_entitlement_schedules (deployment_id, contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at) VALUES (?, ?, ?, NULL, 'configuration-1', 'stable', '1.0.0', NULL, 1, ?)",
  ).bind(input.deploymentId, input.contractId, NOW.toISOString(), NOW.toISOString()).run()
}

async function issueEntitlement(input: Fixture) {
  const payload = {
    schemaVersion: 2,
    revision: 1,
    keyId: "vendor-key",
    leaseId: "lease-1",
    clientId: input.clientId,
    deploymentId: input.deploymentId,
    issuedAt: "2026-08-09T12:00:00.000Z",
    leaseExpiresAt: "2026-08-10T12:00:00.000Z",
    contractStartsAt: "2026-08-01T00:00:00.000Z",
    contractEndsAt: "2026-09-01T00:00:00.000Z",
    graceUntil: "2026-08-17T12:00:00.000Z",
    subscriptionStatus: "active",
    planId: "onboarding-plan",
    maxActiveUsers: 25,
    moduleIds: [],
    addonIds: [],
    configurationVersion: "configuration-1",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0",
  }
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at, issuance_key, envelope_json, contract_revision, schedule_revision, renewal_claim_token) VALUES (?, ?, ?, 1, 'vendor-key', ?, 'signature', ?, ?, 'manual:onboarding', NULL, 1, 1, NULL)",
    ).bind(crypto.randomUUID(), input.deploymentId, input.contractId, JSON.stringify(payload), payload.issuedAt, payload.issuedAt),
    env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET latest_version = 1 WHERE deployment_id = ?",
    ).bind(input.deploymentId),
  ])
}

async function heartbeat(
  deploymentId: string,
  observedAt: Date,
  health = "healthy",
  acknowledgement: { entitlementVersion?: string; configurationVersion?: string } = {},
) {
  await env.CONTROL_DB.prepare(
    "INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, entitlement_version, configuration_version, created_at) VALUES (?, ?, ?, 1, '1.0.0', ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    deploymentId,
    observedAt.toISOString(),
    health,
    acknowledgement.entitlementVersion ?? "1",
    acknowledgement.configurationVersion ?? "configuration-1",
    observedAt.toISOString(),
  ).run()
}

async function issueCurrentEntitlement(input: Fixture, leaseMode: "active" | "grace" = "active") {
  const now = new Date()
  const issuedAt = new Date(now.getTime() - (leaseMode === "grace" ? 25 * HOUR_MS : 60_000)).toISOString()
  const leaseExpiresAt = new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1_000).toISOString()
  const payload = {
    schemaVersion: 2,
    revision: 1,
    keyId: "vendor-key",
    leaseId: `lease-${input.deploymentId}`,
    clientId: input.clientId,
    deploymentId: input.deploymentId,
    issuedAt,
    leaseExpiresAt,
    contractStartsAt: "2020-01-01T00:00:00.000Z",
    contractEndsAt: "2100-01-01T00:00:00.000Z",
    graceUntil: new Date(Date.parse(leaseExpiresAt) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    subscriptionStatus: "active",
    planId: "onboarding-plan",
    maxActiveUsers: 25,
    moduleIds: [],
    addonIds: [],
    configurationVersion: "configuration-1",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0",
  }
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("UPDATE contracts SET starts_at = '2020-01-01', ends_at = '2100-01-01' WHERE id = ?").bind(input.contractId),
    env.CONTROL_DB.prepare(
      "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at, issuance_key, envelope_json, contract_revision, schedule_revision, renewal_claim_token) VALUES (?, ?, ?, 1, 'vendor-key', ?, 'signature', ?, ?, ?, NULL, 1, 1, NULL)",
    ).bind(crypto.randomUUID(), input.deploymentId, input.contractId, JSON.stringify(payload), issuedAt, issuedAt, `route:${input.deploymentId}`),
    env.CONTROL_DB.prepare("UPDATE deployment_entitlement_schedules SET latest_version = 1 WHERE deployment_id = ?").bind(input.deploymentId),
  ])
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])
  const signingKeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  signingPrivateJwk = await crypto.subtle.exportKey("jwk", signingKeyPair.privateKey)
  const now = new Date().toISOString()
  await env.CONTROL_DB.batch([...new Map(roleSubjects.entries())]
    .filter(([token]) => token.startsWith("token-"))
    .flatMap(([token, identity]) => {
      const operatorId = crypto.randomUUID()
      return [
        env.CONTROL_DB.prepare(
          "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
        ).bind(operatorId, identity.email, token, now, now),
        env.CONTROL_DB.prepare(
          "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, ?, ?)",
        ).bind(operatorId, identity.role, now),
      ]
    }))
})

describe("operator onboarding workspace", () => {
  it("issues a bounded token only to the vendor owner and reveals it once", async () => {
    const input = await fixture()

    const denied = await issueInstallTokenRequest(input.deploymentId, { token: "token-vendor_support" })
    expect(denied.status).toBe(403)

    const response = await issueInstallTokenRequest(input.deploymentId)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const html = await response.text()
    const token = html.match(/[A-Za-z0-9_-]{43}/)?.[0]
    expect(token).toBeDefined()
    expect(html.split(token!).length - 1).toBe(1)
    expect(html).toContain("Copy install token")
    expect(html).toContain("cannot be recovered")
    expect(html).toMatch(/<script src="\/operator\/install-token-copy\.js" defer(?:="")?><\/script>/)
    expect(html).not.toContain("navigator.clipboard")

    const script = await app.fetch(new Request("https://control.invalid/operator/install-token-copy.js", {
      headers: { "Cf-Access-Jwt-Assertion": "token-vendor_owner" },
    }), bindings())
    expect(script.status).toBe(200)
    expect(script.headers.get("Content-Type")).toContain("text/javascript")
    expect(await script.text()).toContain("navigator.clipboard")

    const workspace = await workspaceRequest(input.deploymentId)
    expect((await workspace.text())).not.toContain(token!)

    const persisted = await env.CONTROL_DB.prepare(
      "SELECT token_digest FROM install_tokens WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(input.deploymentId).first<{ token_digest: string }>()
    const audit = await env.CONTROL_DB.prepare(
      "SELECT action, target_type, target_id, outcome, metadata_json FROM operator_audit_log WHERE action = 'install_token.issue' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(input.deploymentId).first<{ action: string; target_type: string; target_id: string; outcome: string; metadata_json: string }>()
    expect(persisted?.token_digest).not.toBe(token)
    expect(audit).toMatchObject({
      action: "install_token.issue",
      target_type: "deployment",
      target_id: input.deploymentId,
      outcome: "success",
    })
    expect(audit?.metadata_json).not.toContain(token!)
  })

  it("rejects a repeated install-token idempotency key without creating another token", async () => {
    const input = await fixture()
    const idempotencyKey = crypto.randomUUID()

    expect((await issueInstallTokenRequest(input.deploymentId, { idempotencyKey })).status).toBe(200)
    const repeated = await issueInstallTokenRequest(input.deploymentId, {
      accept: "application/json",
      idempotencyKey,
    })

    expect(repeated.status).toBe(409)
    await expect(repeated.json()).resolves.toEqual({ error: "install_token_already_issued" })
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM install_tokens WHERE deployment_id = ?",
    ).bind(input.deploymentId).first<{ count: number }>()).toEqual({ count: 1 })
  })

  it.each([
    ["text/html", "text/html", "We could not complete this request. Try again. If it persists, contact support."],
    ["application/json", "application/json", null],
  ])("keeps internal errors safe for $0", async (accept, contentType, guidance) => {
    const input = await fixture()
    const response = await issueInstallTokenRequest(input.deploymentId, {
      accept,
      pepper: "too-short",
    })

    expect(response.status).toBe(500)
    expect(response.headers.get("Content-Type")).toContain(contentType)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
    const body = await response.text()
    expect(body).not.toContain("Install token pepper")
    expect(body).not.toContain("too-short")
    if (guidance) {
      expect(body).toContain(guidance)
      expect(body).toMatch(/Request ID: <code>[0-9a-f-]{36}<\/code>/)
      expect(body).toContain('href="/operator"')
    } else {
      expect(JSON.parse(body)).toEqual({ error: "internal_error" })
    }
  })

  it("rejects malformed, past, and overlong install-token expiries without persisting a token", async () => {
    const input = await fixture()
    const before = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM install_tokens WHERE deployment_id = ?",
    ).bind(input.deploymentId).first<{ count: number }>()

    for (const expiresAt of [
      "not-a-date",
      new Date(Date.now() - 1_000).toISOString().slice(0, 16),
      new Date(Date.now() + 24 * 60 * 60 * 1_000 + 60_000).toISOString().slice(0, 16),
    ]) {
      expect((await issueInstallTokenRequest(input.deploymentId, { expiresAt })).status).toBe(400)
    }

    const after = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM install_tokens WHERE deployment_id = ?",
    ).bind(input.deploymentId).first<{ count: number }>()
    expect(after?.count).toBe(before?.count)
  })

  it("rejects calendar-invalid install-token expiry values without normalizing them", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2027-02-28T12:00:00.000Z"))
    try {
      const input = await fixture()

      expect((await issueInstallTokenRequest(input.deploymentId, { expiresAt: "2027-02-29T11:00" })).status).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rolls back token persistence when its issuance audit cannot be recorded", async () => {
    const input = await fixture()

    await expect(issueInstallToken(
      env.CONTROL_DB,
      input.deploymentId,
      bindings().INSTALL_TOKEN_PEPPER,
      new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      { operatorId: crypto.randomUUID(), requestId: "atomic-audit-test" },
    )).rejects.toThrow()

    const token = await env.CONTROL_DB.prepare(
      "SELECT id FROM install_tokens WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(input.deploymentId).first<{ id: string }>()
    expect(token).toBeNull()
  })

  it("rejects invalid and disabled deployments and records only safe failure metadata", async () => {
    const input = await fixture()
    const invalidDeploymentId = crypto.randomUUID()
    expect((await issueInstallTokenRequest(invalidDeploymentId)).status).toBe(404)

    await env.CONTROL_DB.prepare("UPDATE deployments SET status = 'disabled' WHERE id = ?").bind(input.deploymentId).run()
    expect((await issueInstallTokenRequest(input.deploymentId)).status).toBe(404)

    const audits = await env.CONTROL_DB.prepare(
      "SELECT target_id, outcome, metadata_json FROM operator_audit_log WHERE action = 'install_token.issue' AND outcome = 'error' AND target_id IN (?, ?) ORDER BY created_at ASC",
    ).bind(invalidDeploymentId, input.deploymentId).all<{ target_id: string; outcome: string; metadata_json: string }>()
    expect(audits.results).toHaveLength(2)
    expect(audits.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_id: invalidDeploymentId, outcome: "error", metadata_json: '{"errorCode":"not_found"}' }),
      expect.objectContaining({ target_id: input.deploymentId, outcome: "error", metadata_json: '{"errorCode":"not_found"}' }),
    ]))
  })

  it("rejects registered deployments and deployments whose client is disabled", async () => {
    const registered = await fixture()
    await registerDeployment(registered.deploymentId)
    expect((await issueInstallTokenRequest(registered.deploymentId)).status).toBe(404)

    const disabledClient = await fixture()
    await env.CONTROL_DB.prepare("UPDATE clients SET status = 'disabled' WHERE id = ?").bind(disabledClient.clientId).run()
    expect((await issueInstallTokenRequest(disabledClient.deploymentId)).status).toBe(404)
  })

  it("atomically rejects install-token issuance when registration wins after prerequisite review", async () => {
    const input = await fixture()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString()
    const original = await issueInstallToken(
      env.CONTROL_DB,
      input.deploymentId,
      bindings().INSTALL_TOKEN_PEPPER,
      expiresAt,
    )
    let interleaved = false
    const database = new Proxy(env.CONTROL_DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!interleaved) {
              interleaved = true
              await target.prepare(
                "UPDATE deployments SET registered_at = ?, registration_key_fingerprint = ? WHERE id = ?",
              ).bind(NOW.toISOString(), REGISTRATION_FINGERPRINT, input.deploymentId).run()
            }
            return target.batch(statements)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })

    await expect(issueInstallToken(
      database,
      input.deploymentId,
      bindings().INSTALL_TOKEN_PEPPER,
      expiresAt,
    )).rejects.toMatchObject({ status: 404, code: "not_found" })
    expect(interleaved).toBe(true)
    expect(await env.CONTROL_DB.prepare(
      "SELECT id, superseded_at FROM install_tokens WHERE deployment_id = ? ORDER BY created_at",
    ).bind(input.deploymentId).all()).toEqual(expect.objectContaining({
      results: [{ id: original.id, superseded_at: null }],
    }))
  })

  it("preserves the safe failure audit when the request ID is oversized", async () => {
    const invalidDeploymentId = crypto.randomUUID()

    const response = await issueInstallTokenRequest(invalidDeploymentId, { requestId: "r".repeat(1_025) })

    expect(response.status).toBe(404)
    await expect(env.CONTROL_DB.prepare(
      "SELECT outcome, metadata_json FROM operator_audit_log WHERE action = 'install_token.issue' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(invalidDeploymentId).first<{ outcome: string; metadata_json: string }>()).resolves.toEqual({
      outcome: "error",
      metadata_json: '{"errorCode":"not_found"}',
    })
  })

  it("shows the same sanitized request correlation used by the failure audit", async () => {
    const invalidDeploymentId = crypto.randomUUID()
    const correlationId = `correlation-${crypto.randomUUID()}`

    const response = await issueInstallTokenRequest(invalidDeploymentId, {
      accept: "text/html",
      requestId: correlationId,
    })

    expect(response.status).toBe(404)
    expect(await response.text()).toContain(`Request ID: <code>${correlationId}</code>`)
    expect(await env.CONTROL_DB.prepare(
      "SELECT request_id_hash FROM operator_audit_log WHERE action = 'install_token.issue' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(invalidDeploymentId).first<{ request_id_hash: string }>()).toEqual({
      request_id_hash: await hashAuditRequestId(correlationId),
    })
  })

  it("reuses one generated request correlation across the failure audit and HTML error", async () => {
    const invalidDeploymentId = crypto.randomUUID()
    const response = await issueInstallTokenRequest(invalidDeploymentId, { accept: "text/html" })

    expect(response.status).toBe(404)
    const html = await response.text()
    const displayedRequestId = html.match(/Request ID: <code>([0-9a-f-]{36})<\/code>/)?.[1]
    expect(displayedRequestId).toBeDefined()
    expect(await env.CONTROL_DB.prepare(
      "SELECT request_id_hash FROM operator_audit_log WHERE action = 'install_token.issue' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(invalidDeploymentId).first<{ request_id_hash: string }>()).toEqual({
      request_id_hash: await hashAuditRequestId(displayedRequestId!),
    })
  })

  it("falls through an invalid Cf-Ray to a valid X-Request-Id for audit and HTML error", async () => {
    const invalidDeploymentId = crypto.randomUUID()
    const correlationId = `fallback-${crypto.randomUUID()}`
    const response = await issueInstallTokenRequest(invalidDeploymentId, {
      accept: "text/html",
      cfRay: "invalid ray",
      requestId: correlationId,
    })

    expect(response.status).toBe(404)
    expect(await response.text()).toContain(`Request ID: <code>${correlationId}</code>`)
    expect(await env.CONTROL_DB.prepare(
      "SELECT request_id_hash FROM operator_audit_log WHERE action = 'install_token.issue' AND target_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(invalidDeploymentId).first<{ request_id_hash: string }>()).toEqual({
      request_id_hash: await hashAuditRequestId(correlationId),
    })
  })

  it("links the install next action to the token-issuance control", async () => {
    const input = await fixture()

    const html = await (await workspaceRequest(input.deploymentId)).text()

    expect(html).toContain(`href="#install-token"`)
    expect(html).toContain(`<form action="/operator/deployments/${input.deploymentId}/install-tokens" method="post">`)
  })

  it.each([
    {
      label: "superseded",
      expiresAt: "2099-01-01T00:00:00.000Z",
      supersededAt: "2026-08-10T11:30:00.000Z",
      status: "Install token superseded",
    },
    {
      label: "expired",
      expiresAt: "2026-08-09T00:00:00.000Z",
      supersededAt: null,
      status: "Install token expired",
    },
  ])("shows a $label install token truthfully instead of awaiting use", async ({ expiresAt, supersededAt, status }) => {
    const input = await fixture()
    await env.CONTROL_DB.prepare(
      "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, superseded_at, registration_key_fingerprint, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)",
    ).bind(crypto.randomUUID(), input.deploymentId, crypto.randomUUID(), expiresAt, supersededAt, NOW.toISOString()).run()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      token: { expiresAt, supersededAt },
    })
    const html = await (await workspaceRequest(input.deploymentId)).text()
    expect(html).toContain(status)
    expect(html).not.toContain("Install token awaiting use")
    if (supersededAt !== null) {
      expect(html).toContain("Token superseded at (UTC)")
      expect(html).toContain(supersededAt)
    }
  })

  it("places entitlement configuration in the workspace and redirects back after saving", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)

    const before = await (await workspaceRequest(input.deploymentId)).text()
    expect(before).toContain('href="#entitlement-configuration"')
    expect(before).toContain(`<form class="form-grid" method="post" action="/operator/deployments/${input.deploymentId}/entitlements/schedule">`)
    expect(before).toContain("Configuration version")
    expect(before).toContain("Channel")
    expect(before).toContain("Minimum app version")
    expect(before).toContain("Optional SHA-256 image digest")

    const response = await scheduleRequest(input.deploymentId, input.contractId)
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe(
      `/operator/deployments/${input.deploymentId}?notice=entitlement_schedule_updated`,
    )
    const after = await (await workspaceRequest(input.deploymentId)).text()
    expect(after).toContain("configuration-route-1")
    expect(after).toContain("2.3.0")
  })

  it("reviews authoritative contract, seat, module, release, and lease terms without exposing signing material", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT OR IGNORE INTO module_catalog (module_id, display_name, dependency_ids_json, active, created_at, updated_at) VALUES ('projects', 'Projects', '[]', 1, ?, ?)",
      ).bind(NOW.toISOString(), NOW.toISOString()),
      env.CONTROL_DB.prepare(
        "INSERT INTO contract_modules (contract_id, module_id, created_at) VALUES (?, 'projects', ?)",
      ).bind(input.contractId, NOW.toISOString()),
    ])
    await assignSchedule(input)

    const response = await reviewRequest(input.deploymentId)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(input.contractId)
    expect(html).toContain("25 seats")
    expect(html).toContain("Projects")
    expect(html).toContain("Configuration version")
    expect(html).toContain("Stable")
    expect(html).toContain("1.0.0")
    expect(html).toContain("24 hours")
    expect(html).toContain("7 days after lease expiry")
    expect(html).toContain(`action="/operator/deployments/${input.deploymentId}/entitlements/issue"`)
    expect(html).toContain('name="confirmation" value="issue_entitlement"')
    expect(html).not.toContain("vendor-key-route-test")
    expect(html).not.toContain(signingPrivateJwk.d!)
    expect(html).not.toContain('"signature"')
  })

  it("requires explicit HTML confirmation while preserving protected JSON signing", async () => {
    const htmlInput = await fixture()
    await registerDeployment(htmlInput.deploymentId)
    await assignSchedule(htmlInput)

    const rejected = await signingRequest(htmlInput.deploymentId, {
      contractId: htmlInput.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    })
    expect(rejected.status).toBe(400)

    const jsonInput = await fixture()
    await registerDeployment(jsonInput.deploymentId)
    await assignSchedule(jsonInput)
    const compatible = await signingRequest(jsonInput.deploymentId, {
      contractId: jsonInput.contractId,
      idempotencyKey: crypto.randomUUID(),
    }, "json")
    expect(compatible.status).toBe(201)
    await expect(compatible.json()).resolves.toMatchObject({ version: 1 })
  })

  it("rejects a stale HTML review and redirects successful issuance using PRG", async () => {
    const stale = await fixture()
    await registerDeployment(stale.deploymentId)
    await assignSchedule(stale)
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET configuration_version = 'changed-after-review', state_revision = 2 WHERE deployment_id = ?",
    ).bind(stale.deploymentId).run()

    const conflict = await signingRequest(stale.deploymentId, {
      confirmation: "issue_entitlement",
      contractId: stale.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    })
    expect(conflict.status).toBe(409)
    expect((await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM entitlement_versions WHERE deployment_id = ?",
    ).bind(stale.deploymentId).first<{ count: number }>())?.count).toBe(0)

    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    const first = await signingRequest(input.deploymentId, {
      confirmation: "issue_entitlement",
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    })
    expect(first.status).toBe(303)
    expect(first.headers.get("Location")).toBe(
      `/operator/deployments/${input.deploymentId}?notice=entitlement_issued&version=1`,
    )
    expect(await first.text()).not.toContain("signature")

    const second = await signingRequest(input.deploymentId, {
      confirmation: "issue_entitlement",
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    })
    expect(second.status).toBe(303)
    expect(second.headers.get("Location")).toContain("version=2")

    const workspace = await app.fetch(new Request(
      `https://control.invalid${first.headers.get("Location")}`,
      { headers: { "Cf-Access-Jwt-Assertion": "token-vendor_owner" } },
    ), bindings())
    const html = await workspace.text()
    expect(html).toContain("Entitlement version 1 issued")
    expect(html).toContain("Version 2")
    expect(html).toContain("Version 1")

    const review = await (await reviewRequest(input.deploymentId)).text()
    expect(review).toContain("Issue new version")
    expect(review).toContain("Prior immutable versions")
    expect(review).toContain("Version 2")
    expect(review).toContain("Version 1")
    expect(review).not.toContain("vendor-key-route-test")
    expect(review).not.toContain('"signature"')
  })

  it.each([
    {
      label: "state changed",
      status: 409,
      code: "entitlement_state_changed",
      guidance: "Entitlement state changed. Refresh the deployment, review current terms, and issue again.",
      invalidate: (input: Fixture) => env.CONTROL_DB.prepare(
        "UPDATE deployment_entitlement_schedules SET state_revision = state_revision + 1 WHERE deployment_id = ?",
      ).bind(input.deploymentId).run(),
      bindings: {},
    },
    {
      label: "prerequisites unavailable",
      status: 409,
      code: "entitlement_prerequisites_unavailable",
      guidance: "Signing prerequisites are unavailable. Confirm client, deployment, registration, and deployment key status, then retry.",
      invalidate: (input: Fixture) => env.CONTROL_DB.prepare(
        "UPDATE deployment_keys SET revoked_at = ? WHERE deployment_id = ?",
      ).bind(NOW.toISOString(), input.deploymentId).run(),
      bindings: {},
    },
    {
      label: "signing configuration unavailable",
      status: 503,
      code: "signing_configuration_unavailable",
      guidance: "Signing configuration is unavailable. Contact platform operations before retrying.",
      invalidate: async () => undefined,
      bindings: { ENTITLEMENT_SIGNING_PRIVATE_JWK: "" },
    },
  ])("returns safe operator guidance when signing fails because $label", async ({ status, code, guidance, invalidate, bindings: overrides }) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await invalidate(input)
    const data = {
      confirmation: "issue_entitlement",
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    }

    const html = await signingRequest(input.deploymentId, data, "html", {
      accept: "text/html",
      bindings: overrides,
    })
    expect(html.status).toBe(status)
    const body = await html.text()
    expect(body).toContain(guidance)
    expect(body).not.toContain("SQLITE")
    expect(body).not.toContain("CryptoKey")

    if (code === "entitlement_state_changed") return

    const jsonInput = await fixture()
    await registerDeployment(jsonInput.deploymentId)
    await assignSchedule(jsonInput)
    await invalidate(jsonInput)
    const json = await signingRequest(jsonInput.deploymentId, {
      ...data,
      contractId: jsonInput.contractId,
      idempotencyKey: crypto.randomUUID(),
    }, "json", { bindings: overrides })
    expect(json.status).toBe(status)
    await expect(json.json()).resolves.toEqual({ error: code })
  })

  it("records failed schedule and signing mutations against the deployment timeline", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)

    expect((await scheduleRequest(input.deploymentId, input.contractId, {
      releaseChannel: "nightly",
    }, { accept: "application/json" })).status).toBe(400)
    await assignSchedule(input)
    expect((await signingRequest(input.deploymentId, {
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    }, "html", { accept: "application/json" })).status).toBe(400)

    const failures = await env.CONTROL_DB.prepare(
      "SELECT action, target_id FROM operator_audit_log WHERE outcome = 'error' AND action IN ('entitlement.schedule.assign', 'entitlement.issue') AND target_id = ? ORDER BY action",
    ).bind(input.deploymentId).all<{ action: string; target_id: string }>()
    expect(failures.results).toEqual([
      { action: "entitlement.issue", target_id: input.deploymentId },
      { action: "entitlement.schedule.assign", target_id: input.deploymentId },
    ])
  })

  it.each(["vendor_owner", "billing_operator"] as const)("allows %s to schedule and sign", async (role) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    const token = `token-${role}`

    expect((await scheduleRequest(input.deploymentId, input.contractId, {}, { token })).status).toBe(303)
    expect((await signingRequest(input.deploymentId, {
      confirmation: "issue_entitlement",
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    }, "html", { token })).status).toBe(303)
  })

  it.each(["vendor_support", "release_manager", "auditor"] as const)("denies %s all signing mutations", async (role) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    const token = `token-${role}`

    expect((await issueInstallTokenRequest(input.deploymentId, { token })).status).toBe(403)
    expect((await scheduleRequest(input.deploymentId, input.contractId, {}, { token })).status).toBe(403)
    expect((await signingRequest(input.deploymentId, {
      confirmation: "issue_entitlement",
      contractId: input.contractId,
      expectedContractRevision: "1",
      expectedScheduleRevision: "1",
      idempotencyKey: crypto.randomUUID(),
    }, "html", { token })).status).toBe(403)
  })

  it("denies billing operators install-token issuance", async () => {
    const input = await fixture()

    expect((await issueInstallTokenRequest(input.deploymentId, { token: "token-billing_operator" })).status).toBe(403)
  })

  it("labels capped immutable history as the latest 10 versions", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    for (let version = 1; version <= 11; version += 1) {
      const response = await signingRequest(input.deploymentId, {
        confirmation: "issue_entitlement",
        contractId: input.contractId,
        expectedContractRevision: "1",
        expectedScheduleRevision: "1",
        idempotencyKey: crypto.randomUUID(),
      })
      expect(response.status).toBe(303)
    }

    for (const response of [await workspaceRequest(input.deploymentId), await reviewRequest(input.deploymentId)]) {
      const html = await response.text()
      expect(html).toContain(">Latest 10 versions</h2>")
      expect(html).toContain("Showing the latest 10 immutable versions. Older versions remain stored.")
      expect(html).toContain(">Version 11</th>")
      expect(html).not.toContain(">Version 1</th>")
    }
  })

  it("links configure, sign, and renewal next actions to real controls", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    let html = await (await workspaceRequest(input.deploymentId)).text()
    expect(html).toContain('href="#entitlement-configuration"')
    expect(html).toContain(`/operator/deployments/${input.deploymentId}/entitlements/schedule`)

    await assignSchedule(input)
    html = await (await workspaceRequest(input.deploymentId)).text()
    expect(html).toContain(`href="/operator/deployments/${input.deploymentId}/entitlements/review"`)

    await issueCurrentEntitlement(input, "grace")
    await heartbeat(input.deploymentId, new Date())
    html = await (await workspaceRequest(input.deploymentId)).text()
    expect(html).toContain(">Issue new version</h2>")
    expect(html).toContain(`href="/operator/deployments/${input.deploymentId}/entitlements/review"`)
  })

  it("requires a compatible contract before installation", async () => {
    const input = await fixture()
    await env.CONTROL_DB.prepare("DELETE FROM contracts WHERE id = ?").bind(input.contractId).run()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: {
        progress: "contract",
        nextAction: "create_contract",
        licenceState: "unsigned",
        connectivityState: "never_connected",
      },
    })
  })

  it("requires deployment registration before scheduling", async () => {
    const input = await fixture()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "install", nextAction: "issue_install_token" },
    })
  })

  it("requires a schedule after registration", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "configure", nextAction: "configure_entitlement" },
    })
  })

  it("requires signing after a schedule exists", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "sign", nextAction: "issue_entitlement", licenceState: "unsigned" },
    })
  })

  it.each([
    ["contract revision", "UPDATE contracts SET entitlement_revision = entitlement_revision + 1 WHERE id = ?"],
    ["schedule revision", "UPDATE deployment_entitlement_schedules SET state_revision = state_revision + 1 WHERE deployment_id = ?"],
  ])("requires a manually issued new version when the stored %s is stale", async (_label, sql) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1))
    await env.CONTROL_DB.prepare(sql).bind(
      _label === "contract revision" ? input.contractId : input.deploymentId,
    ).run()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: {
        progress: "sign",
        nextAction: "issue_new_version",
        licenceState: "active",
        connectivityState: "online",
      },
    })
  })

  it("requires reconfiguration when the schedule contract is no longer compatible", async () => {
    const input = await fixture()
    const staleContractId = crypto.randomUUID()
    const createdAt = NOW.toISOString()
    await registerDeployment(input.deploymentId)
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'onboarding-plan', 'cancelled', '2026-08-01', '2026-08-31', 25, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)",
      ).bind(staleContractId, input.clientId, createdAt, createdAt),
      env.CONTROL_DB.prepare(
        "INSERT INTO deployment_entitlement_schedules (deployment_id, contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at) VALUES (?, ?, ?, NULL, 'configuration-1', 'stable', '1.0.0', NULL, 1, ?)",
      ).bind(input.deploymentId, staleContractId, createdAt, createdAt),
    ])

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      schedule: { contractId: staleContractId },
      compatibleContracts: [{ id: input.contractId }],
      onboarding: { progress: "configure", nextAction: "configure_entitlement" },
    })
  })

  it.each([
    ["missing", undefined, "never_connected"],
    ["stale", new Date(NOW.getTime() - 30 * 60 * 1_000 - 1), "stale"],
    ["unhealthy", new Date(NOW.getTime() - HOUR_MS), "stale"],
  ] as const)("requires a healthy current heartbeat when it is %s", async (_label, observedAt, connectivityState) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    if (observedAt) await heartbeat(input.deploymentId, observedAt, _label === "unhealthy" ? "unhealthy" : "healthy")

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "verify", nextAction: "verify_heartbeat", licenceState: "active", connectivityState },
    })
  })

  it("marks an unexpired lease active and the workspace complete", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1))

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, new Date("2026-08-10T11:59:59.999Z"))).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "none", licenceState: "active", connectivityState: "online" },
    })
  })

  it.each([
    ["entitlement version", { entitlementVersion: "0" }],
    ["configuration version", { configurationVersion: "configuration-old" }],
  ])("keeps a healthy heartbeat in verify when it acknowledges an old %s", async (_label, acknowledgement) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1), "healthy", acknowledgement)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      latestHeartbeat: acknowledgement,
      onboarding: {
        progress: "verify",
        nextAction: "verify_heartbeat",
        licenceState: "active",
        connectivityState: "online",
      },
    })
  })

  it.each([
    ["replaced", async (deploymentId: string) => {
      const replacementKeyId = crypto.randomUUID()
      await env.CONTROL_DB.batch([
        env.CONTROL_DB.prepare(
          "INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', '{}', ?, '2099-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, ?)",
        ).bind(crypto.randomUUID(), deploymentId, replacementKeyId, "n".repeat(43), NOW.toISOString()),
        env.CONTROL_DB.prepare(
          "UPDATE deployment_keys SET replaced_by_key_id = ? WHERE deployment_id = ? AND fingerprint = ?",
        ).bind(replacementKeyId, deploymentId, REGISTRATION_FINGERPRINT),
      ])
    }],
    ["not yet valid", (deploymentId: string) => env.CONTROL_DB.prepare(
      "UPDATE deployment_keys SET not_before = '2099-01-01T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(deploymentId).run()],
    ["expired", (deploymentId: string) => env.CONTROL_DB.prepare(
      "UPDATE deployment_keys SET expires_at = '2026-08-09T00:00:00.000Z' WHERE deployment_id = ?",
    ).bind(deploymentId).run()],
  ])("does not treat a %s deployment key as valid workspace registration", async (_label, invalidate) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await invalidate(input.deploymentId)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      registration: null,
    })
  })

  it("keeps a grace lease distinct from connectivity and requests a new version", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    const graceNow = new Date("2026-08-11T12:00:00.001Z")
    await heartbeat(input.deploymentId, graceNow)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, graceNow)).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "issue_new_version", licenceState: "grace", connectivityState: "online" },
    })
  })

  it("marks an expired grace lease read-only without conflating it with connectivity", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    const readOnlyNow = new Date("2026-08-17T12:00:00.001Z")
    await heartbeat(input.deploymentId, readOnlyNow)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, readOnlyNow)).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "issue_new_version", licenceState: "read_only", connectivityState: "online" },
    })
  })

  it("returns workspace records without crossing client boundaries", async () => {
    const input = await fixture()
    const createdAt = NOW.toISOString()
    await env.CONTROL_DB.prepare(
      "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, registration_key_fingerprint, created_at) VALUES (?, ?, 'digest', ?, NULL, NULL, ?)",
    ).bind(crypto.randomUUID(), input.deploymentId, "2026-08-11T12:00:00.000Z", createdAt).run()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1))
    const otherClientId = crypto.randomUUID()
    const otherContractId = crypto.randomUUID()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Other', 'active', ?, ?)")
        .bind(otherClientId, `client-${otherClientId}`, createdAt, createdAt),
      env.CONTROL_DB.prepare("INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'onboarding-plan', 'active', '2026-08-01', '2026-08-31', 25, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)")
        .bind(otherContractId, otherClientId, createdAt, createdAt),
      env.CONTROL_DB.prepare("INSERT INTO operator_audit_log (id, operator_id, action, target_type, target_id, outcome, request_id_hash, metadata_json, created_at) VALUES (?, NULL, 'deployment.heartbeat', 'deployment', ?, 'success', 'request', '{}', ?)")
        .bind(crypto.randomUUID(), input.deploymentId, createdAt),
    ])

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      client: { id: input.clientId },
      compatibleContracts: [{ id: input.contractId }],
      registration: { registeredAt: NOW.toISOString(), keyFingerprint: REGISTRATION_FINGERPRINT },
      token: { expiresAt: "2026-08-11T12:00:00.000Z", usedAt: null },
      schedule: { contractId: input.contractId, latestVersion: 1 },
      latestEntitlement: { version: 1 },
      latestHeartbeat: { healthStatus: "healthy" },
      recentEntitlements: [{ version: 1 }],
      recentAuditEvents: [{ action: "deployment.heartbeat" }],
    })
    const workspace = await getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)
    expect(workspace.compatibleContracts.map((contract) => contract.id)).toEqual([input.contractId])
  })

  it("returns only allowlisted audit fields from deployment activity", async () => {
    const input = await fixture()
    const createdAt = NOW.toISOString()
    const auditId = crypto.randomUUID()
    await env.CONTROL_DB.prepare(
      "INSERT INTO operator_audit_log (id, operator_id, action, target_type, target_id, outcome, request_id_hash, metadata_json, created_at) VALUES (?, NULL, 'deployment.heartbeat', 'deployment', ?, 'success', 'request', ?, ?)",
    ).bind(auditId, input.deploymentId, JSON.stringify({ activeUserCount: 17, futureSensitiveField: "do-not-expose" }), createdAt).run()

    const workspace = await getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)

    expect(workspace.recentAuditEvents).toEqual([{
      id: auditId,
      action: "deployment.heartbeat",
      outcome: "success",
      createdAt,
    }])
  })

  it("exposes client deployment links to the signing workspace", async () => {
    const input = await fixture()
    const client = await getClientDetail(
      env.CONTROL_DB,
      input.clientId,
      parseClientChildPagination("https://control.invalid/operator/clients/test"),
    )

    expect(client.deployments.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: input.deploymentId, href: `/operator/deployments/${input.deploymentId}` }),
    ]))
  })

  it.each([
    ["a compatible contract is missing", "Create contract", async (input: Fixture) => {
      await env.CONTROL_DB.prepare("DELETE FROM contracts WHERE id = ?").bind(input.contractId).run()
    }],
    ["registration is required", "Issue install token", async () => {}],
    ["configuration is required", "Configure entitlement", async (input: Fixture) => {
      await registerDeployment(input.deploymentId)
    }],
    ["signing is required", "Issue signed entitlement", async (input: Fixture) => {
      await registerDeployment(input.deploymentId)
      await assignSchedule(input)
    }],
    ["heartbeat verification is required", "Verify heartbeat", async (input: Fixture) => {
      await registerDeployment(input.deploymentId)
      await assignSchedule(input)
      await issueCurrentEntitlement(input)
    }],
    ["lease needs renewal", "Issue new version", async (input: Fixture) => {
      await registerDeployment(input.deploymentId)
      await assignSchedule(input)
      await issueCurrentEntitlement(input, "grace")
      await heartbeat(input.deploymentId, new Date())
    }],
    ["onboarding is complete", "Onboarding complete", async (input: Fixture) => {
      await registerDeployment(input.deploymentId)
      await assignSchedule(input)
      await issueCurrentEntitlement(input)
      await heartbeat(input.deploymentId, new Date())
    }],
  ])("renders required action when %s", async (_label, expectedAction, arrange) => {
    const input = await fixture()
    await arrange(input)

    const response = await workspaceRequest(input.deploymentId)

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const html = await response.text()
    expect(html).toContain(`>${expectedAction}</h2>`)
    expect(html).toContain('aria-label="Deployment signing progress"')
    expect(html).toContain("UTC")
    if (expectedAction === "Issue new version") {
      expect(html).toContain(`class="progress-step progress-step-complete"><a href="/operator/clients/${input.clientId}#contracts-heading"`)
    }
  })

  it("gives truthful disabled-state guidance and offers remote reactivation controls", async () => {
    const input = await fixture()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("UPDATE clients SET status = 'disabled' WHERE id = ?").bind(input.clientId),
      env.CONTROL_DB.prepare("UPDATE deployments SET status = 'disabled' WHERE id = ?").bind(input.deploymentId),
    ])

    const response = await workspaceRequest(input.deploymentId)
    const html = await response.text()

    expect(html).toContain("Client is disabled. Enable it from the client record before continuing deployment setup.")
    expect(html).toContain("Deployment is disabled. Enable it from the lifecycle card below to continue.")
    expect(html).toContain(`href="/operator/clients/${input.clientId}"`)
    expect(html).not.toContain("Reactivate client")
    expect(html).not.toContain("Reactivate deployment")
    expect(html).toContain("progress-step-blocked")
    expect(html).toContain("Remote control")
    expect(html).toContain("Enable deployment")
  })

  it.each(OPERATOR_ROLES)("allows %s to read the deployment workspace", async (role) => {
    const input = await fixture()

    const response = await workspaceRequest(input.deploymentId, `token-${role}`)

    expect(response.status).toBe(200)
  })

  it("keeps deployment workspace behind Cloudflare Access", async () => {
    const input = await fixture()

    expect((await workspaceRequest(input.deploymentId, "")).status).toBe(401)
  })
})
