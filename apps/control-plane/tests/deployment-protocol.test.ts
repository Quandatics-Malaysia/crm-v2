import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import {
  deploymentRequestTranscript,
  lowercaseHex,
  sha256,
  toBase64Url,
} from "@crm/control-protocol/deployment-auth"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { publicKeyFingerprint } from "../src/auth/deployment"
import { createApp } from "../src/index"
import { issueInstallToken } from "../src/repos/deployments"
import { getDeploymentWorkspace } from "../src/repos/onboarding"
import { isSafeOpaqueLegacyKeyId } from "../src/routes/deployments"
import { createDeploymentClient } from "../../deployment-agent/src/client.js"

const pepper = "test-only-install-token-pepper"
const encoder = new TextEncoder()
const legacySharedKeyId = "legacy-agent-key"
const legacyValidDeploymentId = "22222222-2222-4222-8222-222222222222"
const legacyPrivateDeploymentId = "33333333-3333-4333-8333-333333333333"
const legacyMalformedDeploymentId = "44444444-4444-4444-8444-444444444444"
const legacyEntitlementClientId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
const legacyEntitlementDeploymentId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"
const legacyEntitlementContractId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3"
const legacyInstallTokenClientId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
const legacyInstallTokenDeploymentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"
const legacyUnusedInstallTokenIds = [
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
] as const
const legacyUsedInstallTokenId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5"
const unsafeLegacyKeys = [
  {
    label: "unsafe punctuation",
    deploymentId: "88888888-8888-4888-8888-888888888888",
    clientId: "99999999-9999-4999-8999-999999999999",
    keyId: "legacy/key",
  },
  {
    label: "control character",
    deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    keyId: "legacy\u007fkey",
  },
  {
    label: "Unicode",
    deploymentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    keyId: "légacy-key",
  },
  {
    label: "overlong value",
    deploymentId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    clientId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    keyId: "a".repeat(129),
  },
] as const
let legacyValidPrivateKey: CryptoKey
let legacyPrivatePrivateKey: CryptoKey
let legacyInstallTokensAfter0007: Array<{
  id: string
  used_at: string | null
  superseded_at: string | null
}>

function bindings(database: D1Database = env.CONTROL_DB): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    INSTALL_TOKEN_PEPPER: pepper,
  } as unknown as CloudflareBindings
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
  keyId?: string
} = {}) {
  const deploymentId = options.deploymentId ?? await createDeployment()
  const tokenDeploymentId = options.tokenDeploymentId ?? deploymentId
  const keyId = options.keyId ?? crypto.randomUUID()
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
        keyId,
        publicKey: publicJwk,
        agentVersion: "1.2.3",
      }),
    }),
    bindings(options.database),
  )
  return { deploymentId, keyId, pair, publicJwk, token, response }
}

function heartbeatBody(deploymentId: string, overrides: Record<string, unknown> = {}) {
  return {
    deploymentId,
    environment: "production",
    applicationVersion: "2.3.4",
    imageDigest: `sha256:${"a".repeat(64)}`,
    entitlementVersion: "42",
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
  return deploymentRequestTranscript({
    method: "POST",
    path: `/v1/deployments/${deploymentId}/heartbeat`,
    deploymentId,
    keyId,
    timestamp,
    nonce,
    bodyDigestHex: bodyDigest,
  })
}

async function lowercaseHexDigest(body: string): Promise<string> {
  return lowercaseHex(await sha256(encoder.encode(body)))
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
  const migrations = inject("migrations") as D1Migration[]
  await applyD1Migrations(env.CONTROL_DB, migrations.slice(0, 3))

  const validPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const privatePair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  legacyValidPrivateKey = validPair.privateKey
  legacyPrivatePrivateKey = privatePair.privateKey
  const validPublicJwk = await crypto.subtle.exportKey("jwk", validPair.publicKey)
  const privateJwk = await crypto.subtle.exportKey("jwk", privatePair.privateKey)
  const now = "2026-08-01T00:00:00.000Z"
  const legacyRows = [
    {
      clientId: "55555555-5555-4555-8555-555555555555",
      deploymentId: legacyValidDeploymentId,
      publicJwkJson: JSON.stringify(validPublicJwk),
    },
    {
      clientId: "66666666-6666-4666-8666-666666666666",
      deploymentId: legacyPrivateDeploymentId,
      publicJwkJson: JSON.stringify(privateJwk),
    },
    {
      clientId: "77777777-7777-4777-8777-777777777777",
      deploymentId: legacyMalformedDeploymentId,
      publicJwkJson: '{"kty":"OKP","crv":"Ed25519","x":"not-base64url"}',
    },
    ...unsafeLegacyKeys.map((row) => ({
      clientId: row.clientId,
      deploymentId: row.deploymentId,
      keyId: row.keyId,
      publicJwkJson: JSON.stringify(validPublicJwk),
    })),
  ]
  for (const row of legacyRows) {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare(
        "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Legacy client', 'active', ?, ?)",
      ).bind(row.clientId, `legacy-${row.clientId}`, now, now),
      env.CONTROL_DB.prepare(
        "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, ?, 'production', 'active', ?, ?)",
      ).bind(row.deploymentId, row.clientId, `legacy-${row.deploymentId}`, now, now),
      env.CONTROL_DB.prepare(
        "INSERT INTO deployment_keys (id, deployment_id, key_id, public_jwk_json, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      ).bind(
        crypto.randomUUID(),
        row.deploymentId,
        "keyId" in row ? row.keyId : legacySharedKeyId,
        row.publicJwkJson,
        now,
      ),
    ])
  }

  const legacyEntitlementPayload = {
    schemaVersion: 2,
    revision: 1,
    keyId: "legacy-vendor-key",
    leaseId: "legacy-entitlement-lease",
    clientId: legacyEntitlementClientId,
    deploymentId: legacyEntitlementDeploymentId,
    issuedAt: "2026-08-10T11:00:00.000Z",
    leaseExpiresAt: "2026-08-11T11:00:00.000Z",
    contractStartsAt: "2026-08-01T00:00:00.000Z",
    contractEndsAt: "2026-09-01T00:00:00.000Z",
    graceUntil: "2026-08-18T11:00:00.000Z",
    subscriptionStatus: "active",
    planId: "legacy-entitlement-plan",
    maxActiveUsers: 5,
    moduleIds: [],
    addonIds: [],
    configurationVersion: "legacy-configuration",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0",
  }
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('legacy-entitlement-plan', 'legacy-entitlement', 'Legacy entitlement', 1, ?, ?)",
    ).bind(now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, 'legacy-entitlement-client', 'Legacy entitlement client', 'active', ?, ?)",
    ).bind(legacyEntitlementClientId, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, 'legacy-entitlement-deployment', 'production', 'active', ?, ?)",
    ).bind(legacyEntitlementDeploymentId, legacyEntitlementClientId, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployment_keys (id, deployment_id, key_id, public_jwk_json, revoked_at, created_at) VALUES (?, ?, 'legacy-entitlement-agent-key', ?, NULL, ?)",
    ).bind(crypto.randomUUID(), legacyEntitlementDeploymentId, JSON.stringify(validPublicJwk), now),
    env.CONTROL_DB.prepare(
      "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, created_at, updated_at) VALUES (?, ?, 'legacy-entitlement-plan', 'active', '2026-08-01', '2026-08-31', 5, ?, ?)",
    ).bind(legacyEntitlementContractId, legacyEntitlementClientId, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at) VALUES (?, ?, ?, 1, 'legacy-vendor-key', ?, 'legacy-signature', ?, ?)",
    ).bind(crypto.randomUUID(), legacyEntitlementDeploymentId, legacyEntitlementContractId, JSON.stringify(legacyEntitlementPayload), legacyEntitlementPayload.issuedAt, legacyEntitlementPayload.issuedAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, 'legacy-install-token-client', 'Legacy install token client', 'active', ?, ?)",
    ).bind(legacyInstallTokenClientId, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, 'legacy-install-token-deployment', 'production', 'active', ?, ?)",
    ).bind(legacyInstallTokenDeploymentId, legacyInstallTokenClientId, now, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, created_at) VALUES (?, ?, 'legacy-unused-token-one', '2099-01-01T00:00:00.000Z', NULL, '2026-08-01T00:01:00.000Z')",
    ).bind(legacyUnusedInstallTokenIds[0], legacyInstallTokenDeploymentId),
    env.CONTROL_DB.prepare(
      "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, created_at) VALUES (?, ?, 'legacy-unused-token-two', '2099-01-01T00:00:00.000Z', NULL, '2026-08-01T00:02:00.000Z')",
    ).bind(legacyUnusedInstallTokenIds[1], legacyInstallTokenDeploymentId),
    env.CONTROL_DB.prepare(
      "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, created_at) VALUES (?, ?, 'legacy-used-token', '2099-01-01T00:00:00.000Z', '2026-08-01T00:03:00.000Z', '2026-08-01T00:03:00.000Z')",
    ).bind(legacyUsedInstallTokenId, legacyInstallTokenDeploymentId),
  ])

  await applyD1Migrations(env.CONTROL_DB, migrations.slice(0, 7))
  legacyInstallTokensAfter0007 = (await env.CONTROL_DB.prepare(
    "SELECT id, used_at, superseded_at FROM install_tokens WHERE deployment_id = ? ORDER BY created_at",
  ).bind(legacyInstallTokenDeploymentId).all<{
    id: string
    used_at: string | null
    superseded_at: string | null
  }>()).results
  await applyD1Migrations(env.CONTROL_DB, migrations)
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO deployment_entitlement_schedules (deployment_id, contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', 1, 'legacy-configuration', 'stable', '1.0.0', NULL, 1, ?)",
    ).bind(legacyEntitlementDeploymentId, legacyEntitlementContractId, now),
    env.CONTROL_DB.prepare(
      "INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, entitlement_version, configuration_version, created_at) VALUES (?, ?, '2026-08-10T11:59:59.000Z', 1, '1.0.0', 'healthy', '1', 'legacy-configuration', '2026-08-10T11:59:59.000Z')",
    ).bind(crypto.randomUUID(), legacyEntitlementDeploymentId),
  ])
})

describe("deployment protocol migration upgrade", () => {
  it("leaves historical tokens untouched through recorded 0007 then supersedes them in pending migrations", async () => {
    expect(legacyInstallTokensAfter0007).toEqual([
      { id: legacyUnusedInstallTokenIds[0], used_at: null, superseded_at: null },
      { id: legacyUnusedInstallTokenIds[1], used_at: null, superseded_at: null },
      { id: legacyUsedInstallTokenId, used_at: "2026-08-01T00:03:00.000Z", superseded_at: null },
    ])

    const rows = await env.CONTROL_DB.prepare(
      "SELECT id, used_at, superseded_at FROM install_tokens WHERE deployment_id = ? ORDER BY created_at",
    ).bind(legacyInstallTokenDeploymentId).all<{
      id: string
      used_at: string | null
      superseded_at: string | null
    }>()

    expect(rows.results).toEqual([
      { id: legacyUnusedInstallTokenIds[0], used_at: null, superseded_at: "2026-08-01T00:01:00.000Z" },
      { id: legacyUnusedInstallTokenIds[1], used_at: null, superseded_at: "2026-08-01T00:02:00.000Z" },
      { id: legacyUsedInstallTokenId, used_at: "2026-08-01T00:03:00.000Z", superseded_at: null },
    ])
  })

  it("routes a migrated entitlement with missing revision stamps to manual signing", async () => {
    await expect(getDeploymentWorkspace(
      env.CONTROL_DB,
      legacyEntitlementDeploymentId,
      new Date("2026-08-10T12:00:00.000Z"),
    )).resolves.toMatchObject({
      latestEntitlement: { version: 1 },
      onboarding: {
        progress: "sign",
        nextAction: "issue_new_version",
        licenceState: "active",
        connectivityState: "online",
      },
    })
  })

  it("preserves duplicate legacy key IDs and backfills explicit lifecycle state", async () => {
    const rows = await env.CONTROL_DB.prepare(
      "SELECT k.deployment_id, k.algorithm, k.fingerprint, k.not_before, d.registered_at, d.registration_key_fingerprint FROM deployment_keys k JOIN deployments d ON d.id = k.deployment_id WHERE k.key_id = ? ORDER BY k.deployment_id",
    ).bind(legacySharedKeyId).all<{
      deployment_id: string
      algorithm: string | null
      fingerprint: string | null
      not_before: string | null
      registered_at: string | null
      registration_key_fingerprint: string | null
    }>()

    expect(rows.results).toEqual([
      {
        deployment_id: legacyValidDeploymentId,
        algorithm: "Ed25519",
        fingerprint: "legacy:pending",
        not_before: "2026-08-01T00:00:00.000Z",
        registered_at: "2026-08-01T00:00:00.000Z",
        registration_key_fingerprint: "legacy:pending",
      },
      {
        deployment_id: legacyPrivateDeploymentId,
        algorithm: "Ed25519",
        fingerprint: "legacy:pending",
        not_before: "2026-08-01T00:00:00.000Z",
        registered_at: "2026-08-01T00:00:00.000Z",
        registration_key_fingerprint: "legacy:pending",
      },
      {
        deployment_id: legacyMalformedDeploymentId,
        algorithm: "Ed25519",
        fingerprint: "legacy:pending",
        not_before: "2026-08-01T00:00:00.000Z",
        registered_at: "2026-08-01T00:00:00.000Z",
        registration_key_fingerprint: "legacy:pending",
      },
    ])
  })

  it("keeps a valid legacy public Ed25519 key active", async () => {
    const response = await signedHeartbeat({
      deploymentId: legacyValidDeploymentId,
      keyId: legacySharedKeyId,
      privateKey: legacyValidPrivateKey,
    })
    expect(response.status).toBe(202)
  })

  it("fails closed for private and malformed legacy JWK rows", async () => {
    expect((await signedHeartbeat({
      deploymentId: legacyPrivateDeploymentId,
      keyId: legacySharedKeyId,
      privateKey: legacyPrivatePrivateKey,
    })).status).toBe(401)
    expect((await signedHeartbeat({
      deploymentId: legacyMalformedDeploymentId,
      keyId: legacySharedKeyId,
      privateKey: legacyValidPrivateKey,
    })).status).toBe(401)
  })

  it.each(unsafeLegacyKeys)("rejects legacy key ID with $label", async ({ deploymentId, keyId }) => {
    expect(isSafeOpaqueLegacyKeyId(keyId)).toBe(false)
    if (keyId === "légacy-key") return
    expect((await signedHeartbeat({
      deploymentId,
      keyId,
      privateKey: legacyValidPrivateKey,
    })).status).toBe(401)
  })

  it("does not broaden safe opaque IDs to newly stored strict keys", async () => {
    const deploymentId = await createDeployment()
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const exported = await crypto.subtle.exportKey("jwk", pair.publicKey)
    const publicJwk = { kty: "OKP", crv: "Ed25519", x: exported.x! }
    const keyId = "n".repeat(36)
    const now = new Date().toISOString()
    await env.CONTROL_DB.prepare(
      "INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', ?, ?, ?, NULL, NULL, NULL, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      deploymentId,
      keyId,
      JSON.stringify(publicJwk),
      await publicKeyFingerprint(publicJwk.x),
      now,
      now,
    ).run()

    expect(isSafeOpaqueLegacyKeyId(keyId)).toBe(true)
    expect((await signedHeartbeat({
      deploymentId,
      keyId,
      privateKey: pair.privateKey,
    })).status).toBe(401)
  })
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

  it("atomically supersedes the prior unused token so only the replacement can register", async () => {
    const deploymentId = await createDeployment()
    const first = await issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
      undefined,
      crypto.randomUUID(),
    )
    const replacement = await issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
      undefined,
      crypto.randomUUID(),
    )
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const exported = await crypto.subtle.exportKey("jwk", pair.publicKey)
    const register = (installationToken: string, keyId: string) => createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken,
          deploymentId,
          environment: "production",
          keyId,
          publicKey: { kty: "OKP", crv: "Ed25519", x: exported.x },
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )

    expect((await register(first.token, crypto.randomUUID())).status).toBe(401)
    expect((await register(replacement.token, crypto.randomUUID())).status).toBe(201)
    const rows = await env.CONTROL_DB.prepare(
      "SELECT id, superseded_at, idempotency_key_digest FROM install_tokens WHERE deployment_id = ? ORDER BY created_at, id",
    ).bind(deploymentId).all<{ id: string; superseded_at: string | null; idempotency_key_digest: string }>()
    expect(rows.results).toHaveLength(2)
    expect(rows.results.find((row) => row.id === first.id)?.superseded_at).not.toBeNull()
    expect(rows.results.find((row) => row.id === replacement.id)?.superseded_at).toBeNull()
    expect(rows.results.every((row) => /^[A-Za-z0-9_-]{43}$/.test(row.idempotency_key_digest))).toBe(true)
    expect(JSON.stringify(rows.results)).not.toContain(first.token)
    expect(JSON.stringify(rows.results)).not.toContain(replacement.token)
  })

  it("creates at most one token for concurrent reuse of an idempotency key", async () => {
    const deploymentId = await createDeployment()
    const idempotencyKey = crypto.randomUUID()
    const issueOnce = () => issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
      undefined,
      idempotencyKey,
    )

    const results = await Promise.allSettled([issueOnce(), issueOnce()])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, code: "install_token_already_issued" })
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM install_tokens WHERE deployment_id = ?",
    ).bind(deploymentId).first<{ count: number }>()).toEqual({ count: 1 })
  })

  it("atomically consumes a deployment-bound token and stores the client-precommitted key ID", async () => {
    const fixture = await registrationFixture()
    expect(fixture.response.status).toBe(201)
    await expect(fixture.response.json()).resolves.toMatchObject({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
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
      key_id: fixture.keyId,
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

    await env.CONTROL_DB.prepare("UPDATE install_tokens SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), fixture.token.id).run()
    const expiredRetry = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: fixture.token.token,
          deploymentId: fixture.deploymentId,
          environment: "production",
          keyId: fixture.keyId,
          publicKey: fixture.publicJwk,
          agentVersion: "1.2.4",
        }),
      }),
      bindings(),
    )
    expect(expiredRetry.status).toBe(201)
    await expect(expiredRetry.json()).resolves.toEqual({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
    })
    const changedExpiredRetry = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: fixture.token.token,
          deploymentId: fixture.deploymentId,
          environment: "production",
          keyId: crypto.randomUUID(),
          publicKey: fixture.publicJwk,
          agentVersion: "1.2.4",
        }),
      }),
      bindings(),
    )
    expect(changedExpiredRetry.status).toBe(401)
  })

  it("recovers a lost registration response only for the exact consumed token and public key", async () => {
    const fixture = await registrationFixture()
    expect(fixture.response.status).toBe(201)
    const first = await fixture.response.json() as { deploymentId: string; keyId: string }

    const retry = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: fixture.token.token,
          deploymentId: fixture.deploymentId,
          environment: "production",
          keyId: fixture.keyId,
          publicKey: fixture.publicJwk,
          agentVersion: "1.2.4",
        }),
      }),
      bindings(),
    )
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toEqual(first)
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_keys WHERE deployment_id = ?",
    ).bind(fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 1 })

    const audit = await env.CONTROL_DB.prepare(
      "SELECT metadata_json FROM operator_audit_log WHERE action = 'deployment.register.retry' AND target_id = ?",
    ).bind(fixture.deploymentId).first<{ metadata_json: string }>()
    expect(audit?.metadata_json).not.toContain(fixture.token.token)
    expect(audit?.metadata_json).not.toContain(fixture.publicJwk.x!)
  })

  it("rejects expiry, wrong deployment, different-key replay, malformed and private JWKs", async () => {
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

    const stagingDeploymentId = await createDeployment({ environment: "staging" })
    const wrongEnvironment = await registrationFixture({
      deploymentId: stagingDeploymentId,
      tokenDeploymentId: stagingDeploymentId,
    })
    expect(wrongEnvironment.response.status).toBe(401)

    const valid = await registrationFixture()
    expect(valid.response.status).toBe(201)
    const differentPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const differentJwk = await crypto.subtle.exportKey("jwk", differentPair.publicKey)
    const replay = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: valid.token.token,
          deploymentId: valid.deploymentId,
          environment: "production",
          keyId: valid.keyId,
          publicKey: { kty: "OKP", crv: "Ed25519", x: differentJwk.x },
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )
    expect(replay.status).toBe(401)

    const differentKeyId = await createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: valid.token.token,
          deploymentId: valid.deploymentId,
          environment: "production",
          keyId: crypto.randomUUID(),
          publicKey: valid.publicJwk,
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )
    expect(differentKeyId.status).toBe(401)

    const malformed = await registrationFixture({ publicJwk: { kty: "OKP", crv: "Ed25519", x: "AA" } })
    expect(malformed.response.status).toBe(400)
    const privatePair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", privatePair.privateKey)
    const privateKey = await registrationFixture({ publicJwk: privateJwk })
    expect(privateKey.response.status).toBe(400)
  })

  it("returns one key for concurrent identical registration and rolls back failed token claims", async () => {
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
    const keyId = crypto.randomUUID()
    const request = () => createApp().fetch(
      new Request("https://control.invalid/v1/deployments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: token.token,
          deploymentId,
          environment: "production",
          keyId,
          publicKey,
          agentVersion: "1.2.3",
        }),
      }),
      bindings(),
    )
    const responses = await Promise.all([request(), request()])
    expect(responses.map((response) => response.status)).toEqual([201, 201])
    const results = await Promise.all(responses.map((response) => response.json() as Promise<{ keyId: string }>))
    expect(new Set(results.map((result) => result.keyId)).size).toBe(1)
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

describe("live agent/control interoperability", () => {
  it("recovers a lost registration after expiry, then authenticates heartbeat and GET", async () => {
    const deploymentId = await createDeployment({ environment: "development" })
    const token = await issueInstallToken(
      env.CONTROL_DB,
      deploymentId,
      pepper,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const keyId = crypto.randomUUID()
    const identity = {
      schemaVersion: 1 as const,
      deploymentId,
      environment: "development" as const,
      keyId,
      privateJwk: {
        kty: "OKP" as const,
        crv: "Ed25519" as const,
        x: privateJwk.x!,
        d: privateJwk.d!,
      },
    }
    let loseFirstRegistrationResponse = true
    const agentFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const response = await createApp().fetch(request, bindings())
      if (request.url.endsWith("/v1/deployments/register") && loseFirstRegistrationResponse) {
        loseFirstRegistrationResponse = false
        throw new TypeError("response lost after server commit")
      }
      return response
    }
    const clientInput = {
      config: {
        controlPlaneUrl: "https://control.invalid",
        deploymentId,
        environment: "development",
        installationToken: token.token,
        webInternalUrl: "http://web.invalid",
        webSecret: "A".repeat(43),
        applicationVersion: "2.3.4",
        agentVersion: "1.2.3",
        imageDigest: `sha256:${"a".repeat(64)}`,
        migrationVersion: "0066",
      },
      fetch: agentFetch,
    } satisfies Parameters<typeof createDeploymentClient>[0]
    const client = createDeploymentClient(clientInput)
    const signal = new AbortController().signal

    await expect(client.register(identity, signal)).rejects.toThrow("network_error")
    await env.CONTROL_DB.prepare("UPDATE install_tokens SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), token.id).run()
    const restartedClient = createDeploymentClient(clientInput)
    await expect(restartedClient.register(identity, signal)).resolves.toEqual({ deploymentId, keyId })

    await expect(restartedClient.heartbeat(identity, heartbeatBody(deploymentId, {
      environment: "development",
      entitlementVersion: null,
    }) as Parameters<typeof client.heartbeat>[1], signal)).resolves.toEqual({ accepted: true, entitlement: null })
    await expect(restartedClient.entitlement(identity, 1, signal)).rejects.toThrow("http_404")

    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_keys WHERE deployment_id = ? AND key_id = ?",
    ).bind(deploymentId, keyId).first<{ count: number }>()).toEqual({ count: 1 })
    expect(await env.CONTROL_DB.prepare(
      "SELECT COUNT(*) AS count FROM deployment_request_nonces n JOIN deployment_keys k ON k.id = n.deployment_key_id WHERE k.deployment_id = ? AND k.key_id = ?",
    ).bind(deploymentId, keyId).first<{ count: number }>()).toEqual({ count: 2 })
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
    await expect(response.json()).resolves.toEqual({ accepted: true, entitlement: null })

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
      "SELECT COUNT(*) AS count FROM deployment_request_nonces WHERE deployment_key_id = (SELECT id FROM deployment_keys WHERE key_id = ? AND deployment_id = ?)",
    ).bind(fixture.keyId, fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 2 })
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
    await env.CONTROL_DB.prepare(
      `UPDATE deployment_keys SET ${column} = ? WHERE key_id = ? AND deployment_id = ?`,
    )
      .bind(value, fixture.keyId, fixture.deploymentId)
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
      "UPDATE deployment_keys SET not_before = ?, expires_at = ? WHERE key_id = ? AND deployment_id = ?",
    ).bind(
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() - 1).toISOString(),
      expired.keyId,
      expired.deploymentId,
    ).run()
    expect((await signedHeartbeat({
      deploymentId: expired.deploymentId,
      keyId: expired.keyId,
      privateKey: expired.pair.privateKey,
    })).status).toBe(401)

    const replaced = await registeredDeployment()
    await env.CONTROL_DB.prepare(
      "UPDATE deployment_keys SET replaced_by_key_id = key_id WHERE key_id = ? AND deployment_id = ?",
    ).bind(replaced.keyId, replaced.deploymentId).run()
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
      "SELECT COUNT(*) AS count FROM deployment_request_nonces WHERE deployment_key_id = (SELECT id FROM deployment_keys WHERE key_id = ? AND deployment_id = ?)",
    ).bind(fixture.keyId, fixture.deploymentId).first<{ count: number }>()).toEqual({ count: 0 })
  })

  it("rejects deeply nested JSON within the byte limit without overflowing", async () => {
    const fixture = await registeredDeployment()
    const depth = 16_000
    const body = `${"[".repeat(depth)}0${"]".repeat(depth)}`
    expect(encoder.encode(body).byteLength).toBeLessThanOrEqual(32_768)

    const response = await signedHeartbeat({
      deploymentId: fixture.deploymentId,
      keyId: fixture.keyId,
      privateKey: fixture.pair.privateKey,
      body,
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" })
  })
})
