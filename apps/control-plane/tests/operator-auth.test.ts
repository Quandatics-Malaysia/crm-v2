import { applyD1Migrations, env, SELF, type D1Migration } from "cloudflare:test"
import {
  createLocalJWKSet,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose"
import { beforeAll, describe, expect, inject, it } from "vitest"

import {
  AccessTokenInvalidError,
  AccessVerifierUnavailableError,
  createAccessVerifier,
  type AccessVerifier,
} from "../src/auth/access"
import { sanitizeAuditMetadata, writeOperatorAudit } from "../src/audit"
import { createApp } from "../src/index"

const issuer = "https://team.cloudflareaccess.com"
const audience = "operator-audience"

function bindings(overrides: Partial<CloudflareBindings> = {}): CloudflareBindings {
  return {
    ...env,
    ENVIRONMENT: "test",
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: audience,
    BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
    ...overrides,
  } as unknown as CloudflareBindings
}

async function signedAccessToken(
  claims: Record<string, unknown> = {},
  options: { audience?: string; issuer?: string; expiresAt?: number } = {},
): Promise<{ token: string; jwk: JWK }> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA")
  const jwk = await exportJWK(publicKey)
  Object.assign(jwk, { kid: "test-key", alg: "EdDSA", use: "sig" })

  const token = await new SignJWT({ email: "owner@example.com", ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject("access-subject")
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey)

  return { token, jwk }
}

async function fetchSession(verifier: AccessVerifier, token = "verified-token", envOverrides = {}) {
  const app = createApp({ accessVerifier: verifier })

  return app.fetch(
    new Request("https://control.invalid/operator/session", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    }),
    bindings(envOverrides),
  )
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])
})

describe("operator authentication", () => {
  it("rejects a request without the Access assertion even when an email header is spoofed", async () => {
    const response = await SELF.fetch("https://control.invalid/operator/session", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "owner@example.com",
      },
    })

    expect(response.status).toBe(401)
  })

  it("rejects a locally signed Access token with the wrong audience", async () => {
    const { token, jwk } = await signedAccessToken({}, { audience: "wrong-audience" })
    const verifier = createAccessVerifier({
      teamDomain: "team.cloudflareaccess.com",
      audience,
      jwks: createLocalJWKSet({ keys: [jwk] }),
      algorithms: ["EdDSA"],
    })

    await expect(verifier(token)).rejects.toBeInstanceOf(AccessTokenInvalidError)
    expect((await fetchSession(verifier, token)).status).toBe(401)
  })

  it("reports remote JWKS outages as unavailable instead of invalid identity", async () => {
    const { token } = await signedAccessToken()
    const verifier = createAccessVerifier({
      teamDomain: "team.cloudflareaccess.com",
      audience,
      jwks: async () => {
        throw new joseErrors.JWKSTimeout()
      },
      algorithms: ["EdDSA"],
    })

    await expect(verifier(token)).rejects.toBeInstanceOf(AccessVerifierUnavailableError)
    expect((await fetchSession(verifier, token)).status).toBe(503)
  })

  it("rejects an injected verifier when bindings are not the test environment", async () => {
    const id = crypto.randomUUID()
    const subject = `production-${id}`
    const email = `${id}@example.com`
    const now = new Date().toISOString()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
      ).bind(id, email, subject, now, now),
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, 'vendor_owner', ?)",
      ).bind(id, now),
    ])

    const verifier: AccessVerifier = async () => ({ subject, email })
    const response = await fetchSession(verifier, "injected-token", {
      ENVIRONMENT: "production",
    } as unknown as Partial<CloudflareBindings>)

    expect(response.status).toBe(503)
  })

  it("bootstraps the exact normalized owner once and resolves its canonical role", async () => {
    const subject = `bootstrap-${crypto.randomUUID()}`
    const verifier: AccessVerifier = async () => ({
      subject,
      email: "  OWNER@EXAMPLE.COM ",
    })

    const first = await fetchSession(verifier)
    const second = await fetchSession(verifier)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({
      email: "owner@example.com",
      roles: ["vendor_owner"],
    })
    expect(second.status).toBe(200)

    const userCount = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM operator_users WHERE email = ?",
    )
      .bind("owner@example.com")
      .first<{ count: number }>()
    const roleCount = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM operator_roles WHERE operator_id = (SELECT id FROM operator_users WHERE email = ?) AND role = ?",
    )
      .bind("owner@example.com", "vendor_owner")
      .first<{ count: number }>()

    expect(userCount?.count).toBe(1)
    expect(roleCount?.count).toBe(1)
  })

  it("fails closed for an unregistered non-bootstrap identity", async () => {
    const verifier: AccessVerifier = async () => ({
      subject: `unregistered-${crypto.randomUUID()}`,
      email: `unregistered-${crypto.randomUUID()}@example.com`,
    })

    expect((await fetchSession(verifier)).status).toBe(403)
  })

  it("atomically binds a verified Access subject to a pre-provisioned operator", async () => {
    const id = crypto.randomUUID()
    const subject = `bound-${id}`
    const email = `${id}@example.com`
    const now = new Date().toISOString()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', NULL, ?, ?)",
      ).bind(id, email, now, now),
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, 'vendor_support', ?)",
      ).bind(id, now),
    ])

    const verifier: AccessVerifier = async () => ({ subject, email })
    expect((await fetchSession(verifier)).status).toBe(200)

    const operator = await env.CONTROL_DB.prepare(
      "SELECT access_subject FROM operator_users WHERE id = ?",
    )
      .bind(id)
      .first<{ access_subject: string | null }>()
    const audit = await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM operator_audit_log WHERE operator_id = ? AND action = ?",
    )
      .bind(id, "operator.access_subject.bind")
      .first<{ count: number }>()

    expect(operator?.access_subject).toBe(subject)
    expect(audit?.count).toBe(1)
  })

  it.each([
    { status: "disabled", role: "vendor_owner", label: "disabled operator" },
    { status: "active", role: "super_admin", label: "unknown role" },
  ])("rejects $label", async ({ status, role }) => {
    const id = crypto.randomUUID()
    const subject = `subject-${id}`
    const email = `${id}@example.com`
    const now = new Date().toISOString()

    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, email, status, subject, now, now),
      env.CONTROL_DB.prepare(
        "INSERT INTO operator_roles (operator_id, role, created_at) VALUES (?, ?, ?)",
      ).bind(id, role, now),
    ])

    const verifier: AccessVerifier = async () => ({ subject, email })
    expect((await fetchSession(verifier)).status).toBe(403)
  })
})

describe("operator audit", () => {
  it("hashes request IDs and stores canonical bounded metadata", async () => {
    const operatorId = crypto.randomUUID()
    const email = `${operatorId}@example.com`
    const now = new Date().toISOString()
    await env.CONTROL_DB.prepare(
      "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
    )
      .bind(operatorId, email, `audit-${operatorId}`, now, now)
      .run()

    const auditId = await writeOperatorAudit(env.CONTROL_DB, {
      operatorId,
      action: "operator.session.read",
      targetType: "operator_user",
      targetId: operatorId,
      outcome: "success",
      requestId: "raw-request-id",
      metadata: { after: { role: "vendor_owner" }, before: null },
    })
    const row = await env.CONTROL_DB.prepare(
      "SELECT outcome, request_id_hash, metadata_json FROM operator_audit_log WHERE id = ?",
    )
      .bind(auditId)
      .first<{ outcome: string; request_id_hash: string; metadata_json: string }>()

    expect(row?.outcome).toBe("success")
    expect(row?.request_id_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row?.request_id_hash).not.toContain("raw-request-id")
    expect(row?.metadata_json).toBe('{"after":{"role":"vendor_owner"},"before":null}')
  })

  it.each([
    "apiKey",
    "access_token",
    "authorizationHeader",
    "cookieValue",
    "privateJwk",
    "install-token",
  ])("rejects sensitive audit metadata key %s", (key) => {
    expect(() => sanitizeAuditMetadata({ [key]: "secret" })).toThrow("sensitive")
  })

  it("rejects unbounded audit metadata", () => {
    expect(() => sanitizeAuditMetadata({ value: "x".repeat(9_000) })).toThrow("limit")
  })

  it("keeps audit rows append-only", async () => {
    const row = await env.CONTROL_DB.prepare("SELECT id FROM operator_audit_log LIMIT 1").first<{
      id: string
    }>()
    expect(row).not.toBeNull()

    await expect(
      env.CONTROL_DB.prepare("UPDATE operator_audit_log SET action = ? WHERE id = ?")
        .bind("tampered", row!.id)
        .run(),
    ).rejects.toThrow()
    await expect(
      env.CONTROL_DB.prepare("DELETE FROM operator_audit_log WHERE id = ?").bind(row!.id).run(),
    ).rejects.toThrow()
  })
})
