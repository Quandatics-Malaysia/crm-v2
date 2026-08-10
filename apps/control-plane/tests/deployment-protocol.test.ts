import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { createApp } from "../src/index"
import { issueInstallToken } from "../src/repos/deployments"

const pepper = "test-only-install-token-pepper"
const encoder = new TextEncoder()

function bindings(database: D1Database = env.CONTROL_DB): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    INSTALL_TOKEN_PEPPER: pepper,
  } as unknown as CloudflareBindings
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function randomNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function createDeployment(options: {
  environment?: "development" | "staging" | "production"
  status?: string
} = {}): Promise<string> {
  const clientId = crypto.randomUUID()
  const deploymentId = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    ).bind(clientId, `client-${clientId}`, "Protocol client", now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      deploymentId,
      clientId,
      `deployment-${deploymentId}`,
      options.environment ?? "production",
      options.status ?? "active",
      now,
      now,
    ),
  ])
  return deploymentId
}

async function registrationFixture(options: {
  database?: D1Database
  deploymentId?: string
  tokenDeploymentId?: string
  expiresAt?: string
  publicJwk?: JsonWebKey
} = {}) {
  const deploymentId = options.deploymentId ?? await createDeployment()
  const tokenDeploymentId = options.tokenDeploymentId ?? deploymentId
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const exportedPublicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const publicJwk = options.publicJwk ?? {
    kty: "OKP",
    crv: "Ed25519",
    x: exportedPublicJwk.x,
  }
  const token = await issueInstallToken(
    env.CONTROL_DB,
    tokenDeploymentId,
    pepper,
    options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  )
  const app = createApp()
  const response = await app.fetch(
    new Request("https://control.invalid/v1/deployments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationToken: token.token,
        deploymentId,
        environment: "production",
        publicKey: publicJwk,
        agentVersion: "1.2.3",
      }),
    }),
    bindings(options.database),
  )
  return { deploymentId, pair, publicJwk, token, response }
}

function heartbeatBody(deploymentId: string, overrides: Record<string, unknown> = {}) {
  return {
    deploymentId,
    environment: "production",
    applicationVersion: "2.3.4",
    imageDigest: `sha256:${"a".repeat(64)}`,
    entitlementVersion: "entitlement-42",
    configurationVersion: "config-7",
    activeUserCount: 17,
    reservedInvitationCount: 3,
    enabledModuleIds: ["projects", "salesOrders"],
    healthState: "healthy",
    migrationVersion: "migration-19",
    lastSuccessfulBackupAt: "2026-08-10T01:02:03.000Z",
    lastRestoreTestAt: null,
    agentVersion: "1.2.3",
    ...overrides,
  }
}

function transcript(
  deploymentId: string,
  keyId: string,
  timestamp: string,
  nonce: string,
  bodyDigest: string,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `crm-deployment-request-v1\nPOST\n/v1/deployments/${deploymentId}/heartbeat\n${deploymentId}\n${keyId}\n${timestamp}\n${nonce}\nsha-256=${bodyDigest}\n`,
  )
}

async function lowercaseHexDigest(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function signedHeartbeat(options: {
  deploymentId: string
  keyId: string
  privateKey: CryptoKey
  body?: Record<string, unknown> | string
  signedBody?: string
  timestamp?: string
  nonce?: string
  signature?: string
  routeDeploymentId?: string
  headerKeyId?: string
  database?: D1Database
  method?: string
  headers?: Headers
}) {
  const body = typeof options.body === "string"
    ? options.body
    : JSON.stringify(options.body ?? heartbeatBody(options.deploymentId))
  const signedBody = options.signedBody ?? body
  const timestamp = options.timestamp ?? new Date().toISOString()
  const nonce = options.nonce ?? randomNonce()
  const keyId = options.headerKeyId ?? options.keyId
  const routeDeploymentId = options.routeDeploymentId ?? options.deploymentId
  const signature = options.signature ?? toBase64Url(new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    options.privateKey,
    transcript(
      options.deploymentId,
      options.keyId,
      timestamp,
      nonce,
      await lowercaseHexDigest(signedBody),
    ),
  )))
  const headers = options.headers ?? new Headers()
  headers.set("Content-Type", "application/json")
  if (!headers.has("X-Deployment-Key-Id")) headers.set("X-Deployment-Key-Id", keyId)
  if (!headers.has("X-Deployment-Timestamp")) headers.set("X-Deployment-Timestamp", timestamp)
  if (!headers.has("X-Deployment-Nonce")) headers.set("X-Deployment-Nonce", nonce)
  if (!headers.has("X-Deployment-Signature")) headers.set("X-Deployment-Signature", signature)

  return createApp().fetch(
    new Request(`https://control.invalid/v1/deployments/${routeDeploymentId}/heartbeat`, {
      method: options.method ?? "POST",
      headers,
      body,
    }),
    bindings(options.database),
  )
}

async function registeredDeployment() {
  const fixture = await registrationFixture()
  expect(fixture.response.status).toBe(201)
  const result = await fixture.response.json() as { deploymentId: string; keyId: string }
  return { ...fixture, keyId: result.keyId }
}

function failingBatchDatabase(): D1Database {
  return new Proxy(env.CONTROL_DB, {
    get(target, property) {
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => target.batch([
          ...statements,
          target.prepare("INSERT INTO deployment_keys (id) VALUES (?)").bind(crypto.randomUUID()),
        ])
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])
})

describe("deployment registration", () => {
  it("issues 32 random bytes once and stores only a peppered fixed-size digest", async () => {
    const deploymentId = await createDeployment()
    const issued = await issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const row = await env.CONTROL_DB.prepare(
      "SELECT token_digest FROM install_tokens WHERE id = ?",
    ).bind(issued.id).first<{ token_digest: string }>()

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(row?.token_digest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(row?.token_digest).not.toBe(issued.token)
    expect(JSON.stringify(row)).not.toContain(issued.token)
  })

  it("atomically consumes a deployment-bound token and creates one server-named public key", async () => {
    const fixture = await registrationFixture()
    expect(fixture.response.status).toBe(201)
    await expect(fixture.response.json()).resolves.toMatchObject({
      deploymentId: fixture.deploymentId,
      keyId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })

    const state = await env.CONTROL_DB.prepare(
      "SELECT t.used_at, t.registration_key_fingerprint AS token_fingerprint, d.registered_at, d.registration_key_fingerprint AS deployment_fingerprint FROM install_tokens t JOIN deployments d ON d.id = t.deployment_id WHERE t.id = ?",
    ).bind(fixture.token.id).first<Record<string, string | null>>()
    const keys = await env.CONTROL_DB.prepare(
      "SELECT key_id, algorithm, fingerprint, public_jwk_json, not_before, expires_at, revoked_at, registration_token_id FROM deployment_keys WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).all<Record<string, string | null>>()
    expect(state?.used_at).not.toBeNull()
    expect(state?.token_fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state?.deployment_fingerprint).toBe(state?.token_fingerprint)
    expect(keys.results).toHaveLength(1)
    expect(keys.results[0]).toMatchObject({
      algorithm: "Ed25519",
      fingerprint: state?.token_fingerprint,
      expires_at: null,
      revoked_at: null,
      registration_token_id: fixture.token.id,
    })
    expect(JSON.parse(keys.results[0]!.public_jwk_json!)).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: fixture.publicJwk.x,
    })

    const audit = await env.CONTROL_DB.prepare(
      "SELECT metadata_json FROM operator_audit_log WHERE action = 'deployment.register' AND target_id = ?",
    ).bind(fixture.deploymentId).first<{ metadata_json: string }>()
    expect(audit?.metadata_json).not.toContain(fixture.token.token)
    expect(audit?.metadata_json).not.toContain(fixture.publicJwk.x!)
  })

  it("rejects expiry, wrong deployment, replay, malformed and private JWKs", async () => {
    const expired = await registrationFixture({
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect(expired.response.status).toBe(401)

    const tokenDeploymentId = await createDeployment()
    const wrongDeploymentId = await createDeployment()
    const wrong = await registrationFixture({
      deploymentId: wrongDeploymentId,
      tokenDeploymentId,
    })
    expect(wrong.response.status).toBe(401)

    const valid = await registrationFixture()
    expect(valid.response.status).toBe(201)
    const replay = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: valid.token.token,
          deploymentId: valid.deploymentId,
          environment: "production",
          publicKey: valid.publicJwk,
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )
    expect(replay.status).toBe(401)

    const malformed = await registrationFixture({ publicJwk: { kty: "OKP", crv: "Ed25519", x: "AA" } })
    expect(malformed.response.status).toBe(400)
    const privatePair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", privatePair.privateKey)
    const privateKey = await registrationFixture({ publicJwk: privateJwk })
    expect(privateKey.response.status).toBe(400)
  })

  it("allows exactly one concurrent registration and rolls back token claims when key insert fails", async () => {
    const deploymentId = await createDeployment()
    const token = await issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const exportedPublicKey = await crypto.subtle.exportKey("jwk", pair.publicKey)
    const publicKey = { kty: "OKP", crv: "Ed25519", x: exportedPublicKey.x }
    const request = () => createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: token.token,
          deploymentId,
          environment: "production",
          publicKey,
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )
    const statuses = (await Promise.all([request(), request()])).map((response) => response.status)
    expect(statuses.filter((status) => status === 201)).toHaveLength(1)
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_keys WHERE deployment_id = ?",
    ).bind(deploymentId).first<{ count: number }>()).toEqual({ count: 1 })

    const rollbackDeploymentId = await createDeployment()
    const rollbackToken = await issueInstallToken(
      env.CONTROL_DB,
      rollbackDeploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const failed = await registrationFixture({
      database: failingBatchDatabase(),
      deploymentId: rollbackDeploymentId,
      tokenDeploymentId: rollbackDeploymentId,
    })
    expect(failed.response.status).toBe(500)
    expect(await env.CONTROL_DB.prepare(
      "SELECT used_at FROM install_tokens WHERE id = ?",
    ).bind(failed.token.id).first<{ used_at: string | null }>()).toEqual({ used_at: null })
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_keys WHERE deployment_id = ?",
    ).bind(rollbackDeploymentId).first<{ count: number }>()).toEqual({ count: 0 })
    expect(rollbackToken.token).not.toBe(failed.token.token)
  })
})

describe("signed deployment heartbeats", () => {
  it("accepts exact signed bytes and persists only bounded rollup metadata", async () => {
    const fixture = await registeredDeployment()
    const response = await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ accepted: true })

    const row = await env.CONTROL_DB.prepare(
      "SELECT occupied_seats, active_user_count, reserved_invitation_count, application_version, image_digest, enabled_module_ids_json, health_status, client_timestamp FROM heartbeat_rollups WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<Record<string, string | number>>()
    expect(row).toMatchObject({
      occupied_seats: 20,
      active_user_count: 17,
      reserved_invitation_count: 3,
      application_version: "2.3.4",
      image_digest: `sha256:${"a".repeat(64)}`,
      enabled_module_ids_json: '["projects","salesOrders"]',
      health_status: "healthy",
    })
    expect(row?.client_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("binds signature to body bytes, route, key ID, timestamp, and nonce", async () => {
    const fixture = await registeredDeployment()
    const validBody = JSON.stringify(heartbeatBody(fixture.deploymentId))
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: validBody.replace('"activeUserCount":17', '"activeUserCount":18'),
      signedBody: validBody,
    })).status).toBe(401)

    const otherDeploymentId = await createDeployment()
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      routeDeploymentId: otherDeploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      routeDeploymentId: fixture.deploymentId.replace("-", "%2D"),
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      headerKeyId: crypto.randomUUID(),
      privateKey: fixture.pair.privateKey,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      signature: toBase64Url(crypto.getRandomValues(new Uint8Array(64))),
    })).status).toBe(401)

    const timestamp = new Date().toISOString()
    const nonce = randomNonce()
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      fixture.pair.privateKey,
      transcript(
        fixture.deploymentId,
        fixture.keyId,
        timestamp,
        nonce,
        await lowercaseHexDigest(validBody),
      ),
    )))
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: validBody,
      timestamp: new Date(Date.parse(timestamp) + 1_000).toISOString(),
      nonce,
      signature,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: validBody,
      timestamp,
      nonce: randomNonce(),
      signature,
    })).status).toBe(401)

    const duplicateHeaders = new Headers({
      "X-Deployment-Key-Id": fixture.keyId,
      "X-Deployment-Timestamp": timestamp,
      "X-Deployment-Nonce": nonce,
      "X-Deployment-Signature": signature,
    })
    duplicateHeaders.append("X-Deployment-Timestamp", timestamp)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: validBody,
      timestamp,
      nonce,
      signature,
      headers: duplicateHeaders,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      method: "PUT",
    })).status).not.toBe(202)
  })

  it("rejects route/body mismatch after signature verification", async () => {
    const fixture = await registeredDeployment()
    const otherDeploymentId = await createDeployment()
    const body = JSON.stringify(heartbeatBody(otherDeploymentId))
    const timestamp = new Date().toISOString()
    const nonce = randomNonce()
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      fixture.pair.privateKey,
      transcript(
        fixture.deploymentId,
        fixture.keyId,
        timestamp,
        nonce,
        await lowercaseHexDigest(body),
      ),
    )))
    const response = await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body,
      timestamp,
      nonce,
      signature,
    })
    expect(response.status).toBe(400)
  })

  it("consumes a nonce once under sequential and concurrent replay", async () => {
    const fixture = await registeredDeployment()
    const body = JSON.stringify(heartbeatBody(fixture.deploymentId))
    const timestamp = new Date().toISOString()
    const nonce = randomNonce()
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      fixture.pair.privateKey,
      transcript(fixture.deploymentId, fixture.keyId, timestamp, nonce, await lowercaseHexDigest(body)),
    )))
    const request = () => signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body,
      timestamp,
      nonce,
      signature,
    })
    expect((await request()).status).toBe(202)
    expect((await request()).status).toBe(401)

    const nonce2 = randomNonce()
    const signature2 = toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      fixture.pair.privateKey,
      transcript(fixture.deploymentId, fixture.keyId, timestamp, nonce2, await lowercaseHexDigest(body)),
    )))
    const concurrent = () => signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body,
      timestamp,
      nonce: nonce2,
      signature: signature2,
    })
    const statuses = (await Promise.all([concurrent(), concurrent()])).map((response) => response.status)
    expect(statuses.filter((status) => status === 202)).toHaveLength(1)
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM heartbeat_rollups WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 2 })
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_request_nonces WHERE deployment_key_id = (SELECT id FROM deployment_keys WHERE key_id = ?)",
    ).bind(fixture.keyId).first<{ count: number }>()).toEqual({ count: 2 })
  })

  it("enforces five-minute freshness on both sides and canonical timestamp syntax", async () => {
    const fixture = await registeredDeployment()
    for (const offset of [-299_000, 299_000]) {
      expect((await signedHeartbeat({
        deploymentId: fixture.deploymentId,
        keyId: fixture.keyId,
        privateKey: fixture.pair.privateKey,
        timestamp: new Date(Date.now() + offset).toISOString(),
      })).status).toBe(202)
    }
    for (const offset of [-301_000, 301_000]) {
      expect((await signedHeartbeat({
        deploymentId: fixture.deploymentId,
        keyId: fixture.keyId,
        privateKey: fixture.pair.privateKey,
        timestamp: new Date(Date.now() + offset).toISOString(),
      })).status).toBe(401)
    }
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    })).status).toBe(401)
  })

  it.each([
    ["revoked", { revoked_at: new Date().toISOString() }],
    ["not yet valid", { not_before: new Date(Date.now() + 60_000).toISOString() }],
  ])("rejects a %s key", async (_label, update) => {
    const fixture = await registeredDeployment()
    const [column, value] = Object.entries(update)[0]!
    await env.CONTROL_DB.prepare(`UPDATE deployment_keys SET ${column} = ? WHERE key_id = ?`)
      .bind(value, fixture.keyId)
      .run()
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
    })).status).toBe(401)
  })

  it("rejects expired and replaced keys", async () => {
    const expired = await registeredDeployment()
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_keys SET not_before = ?, expires_at = ? WHERE key_id = ?",
    ).bind(
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() - 1).toISOString(),
      expired.keyId,
    ).run()
    expect((await signedHeartbeat({
      deploymentId: expired.deploymentId,
      keyId: expired.keyId,
      privateKey: expired.pair.privateKey,
    })).status).toBe(401)

    const replaced = await registeredDeployment()
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_keys SET replaced_by_key_id = key_id WHERE key_id = ?",
    ).bind(replaced.keyId).run()
    expect((await signedHeartbeat({
      deploymentId: replaced.deploymentId,
      keyId: replaced.keyId,
      privateKey: replaced.pair.privateKey,
    })).status).toBe(401)
  })

  it("rejects inactive deployments and keys belonging to another deployment", async () => {
    const fixture = await registeredDeployment()
    await env.CONTROL_DB.prepare("UPDATE deployments SET status = 'suspended' WHERE id = ?")
      .bind(fixture.deploymentId)
      .run()
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
    })).status).toBe(401)
  })

  it.each([
    ["unknown field", { email: "person@example.com" }],
    ["email in version", { applicationVersion: "person@example.com" }],
    ["URL in opaque ID", { migrationVersion: "https://example.com/customer" }],
    ["stack trace", { configurationVersion: "Error: customer\n at private.ts:1" }],
    ["invalid digest", { imageDigest: "customer-image" }],
    ["negative count", { activeUserCount: -1 }],
    ["duplicate module", { enabledModuleIds: ["projects", "projects"] }],
  ])("rejects PII/free-text telemetry: %s", async (_label, override) => {
    const fixture = await registeredDeployment()
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: heartbeatBody(fixture.deploymentId, override),
    })).status).toBe(400)
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM heartbeat_rollups WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 0 })
  })

  it("rejects oversized, repeated-key, malformed header, and base64url edge cases without persistence", async () => {
    const fixture = await registeredDeployment()
    const oversized = `${JSON.stringify(heartbeatBody(fixture.deploymentId)).slice(0, -1)},"padding":"${"x".repeat(33_000)}"}`
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: oversized,
    })).status).toBe(400)

    const repeated = JSON.stringify(heartbeatBody(fixture.deploymentId)).replace(
      `"deploymentId":"${fixture.deploymentId}"`,
      `"deploymentId":"${fixture.deploymentId}","deploymentId":"${fixture.deploymentId}"`,
    )
    expect((await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body: repeated,
    })).status).toBe(400)

    for (const bad of ["AA", `${randomNonce()}=`, "_".repeat(44)]) {
      expect((await signedHeartbeat({
        deploymentId: fixture.deploymentId,
        keyId: fixture.keyId,
        privateKey: fixture.pair.privateKey,
        nonce: bad,
      })).status).toBe(401)
    }
    for (const bad of ["AA", `${toBase64Url(new Uint8Array(64))}=`, "_".repeat(87)]) {
      expect((await signedHeartbeat({
        deploymentId: fixture.deploymentId,
        keyId: fixture.keyId,
        privateKey: fixture.pair.privateKey,
        signature: bad,
      })).status).toBe(401)
    }
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM heartbeat_rollups WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 0 })
  })

  it("rolls back nonce consumption when rollup persistence fails", async () => {
    const fixture = await registeredDeployment()
    const nonce = randomNonce()
    const response = await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      nonce,
      database: failingBatchDatabase(),
    })
    expect(response.status).toBe(500)
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_request_nonces WHERE deployment_key_id = (SELECT id FROM deployment_keys WHERE key_id = ?)",
    ).bind(fixture.keyId).first<{ count: number }>()).toEqual({ count: 0 })
  })
})
