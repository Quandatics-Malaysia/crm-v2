import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest"

import {
  deploymentRequestTranscript,
  installTokenDigest,
  lowercaseHex,
  publicKeyFingerprint,
  sha256,
  type CommandEnvelope,
  type CommandEnvelopePayload,
  commandTtlBounds,
  signCommandEnvelope,
} from "@crm/control-protocol"
import { publicKeyFingerprint as publicKeyFingerprintAuth, readBoundedRequestBody, toBase64Url } from "../src/auth/deployment"
import { createApp } from "../src/index"
import { issueInstallToken } from "../src/repos/deployments"
import { readCommandEnvelope } from "../src/repos/commands"

import { getCommandHistory } from "../src/repos/commands"

const pepper = "test-only-install-token-pepper"
const deploymentId = "11111111-4111-4111-8111-aaaaaaaaaaaa"
const clientId = "22222222-4222-4222-8222-aaaaaaaaaaaa"
const operatorId = "33333333-4333-4333-8333-aaaaaaaaaaaa"

function bindings(database: D1Database = env.CONTROL_DB): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-cmd-route",
    ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
  } as unknown as CloudflareBindings
}

let migrations: D1Migration[]
let privateJwk: JsonWebKey
let publicJwk: JsonWebKey

beforeAll(async () => {
  migrations = inject("migrations") as D1Migration[]
  await applyD1Migrations(env.CONTROL_DB, migrations)
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  const now = new Date("2026-08-19T00:00:00.000Z").toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("INSERT INTO operator_users (id, email, access_subject, status, created_at, updated_at) VALUES (?, 'vendor@example.com', 'sub-cmd-route', 'active', ?, ?)")
      .bind(operatorId, now, now),
    env.CONTROL_DB.prepare("INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, 'client-cmd-route', 'CmdRoute', 'active', ?, ?)")
      .bind(clientId, now, now),
    env.CONTROL_DB.prepare("INSERT INTO deployments (id, client_id, deployment_key, environment, status, registered_at, registration_key_fingerprint, created_at, updated_at) VALUES (?, ?, ?, 'production', 'active', NULL, NULL, ?, ?)")
      .bind(deploymentId, clientId, `dep-cmd-route`, now, now),
  ])

  const agentPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  const agentPublic = await crypto.subtle.exportKey("jwk", agentPair.publicKey)
  const token = await issueInstallToken(
    env.CONTROL_DB,
    deploymentId,
    pepper,
    new Date("2030-01-01T00:00:00.000Z").toISOString(),
  )
  const keyId = crypto.randomUUID()
  const app = createApp()
  await app.fetch(
    new Request("https://control.invalid/v1/deployments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationToken: token.token,
        deploymentId,
        environment: "production",
        keyId,
        publicKey: { kty: "OKP", crv: "Ed25519", x: agentPublic.x },
        agentVersion: "1.0.0",
      }),
    }),
    bindings(),
  )
  seedRegisteredDeploymentKeyResult = {
    privateJwk: await crypto.subtle.exportKey("jwk", agentPair.privateKey),
    keyId,
  }
})

let seedRegisteredDeploymentKeyResult: { privateJwk: JsonWebKey; keyId: string }

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DELETE FROM deployment_command_audit"),
    env.CONTROL_DB.prepare("DELETE FROM deployment_command_queue"),
  ])
})

async function signedHeaders(input: {
  method: "GET" | "POST"
  path: string
  body: string | Uint8Array
  keyId: string
  privateKey: JsonWebKey
  now?: Date
}): Promise<Headers> {
  const encoder = new TextEncoder()
  const bodyBytes = typeof input.body === "string" ? encoder.encode(input.body) : new Uint8Array(input.body)
  const timestamp = (input.now ?? new Date()).toISOString()
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = toBase64Url(nonceBytes)
  const digest = lowercaseHex(await sha256(bodyBytes))
  const transcript = deploymentRequestTranscript({
    method: input.method,
    path: input.path,
    deploymentId,
    keyId: input.keyId,
    timestamp,
    nonce,
    bodyDigestHex: digest,
  })
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    await crypto.subtle.importKey("jwk", input.privateKey, { name: "Ed25519" }, false, ["sign"]),
    transcript,
  )))
  return new Headers({
    "X-Deployment-Key-Id": input.keyId,
    "X-Deployment-Timestamp": timestamp,
    "X-Deployment-Nonce": nonce,
    "X-Deployment-Signature": signature,
  })
}

function commandPayload(id: string, overrides: Partial<CommandEnvelopePayload> = {}): CommandEnvelopePayload {
  const bounds = commandTtlBounds(new Date("2026-08-19T00:01:00.000Z"), 5 * 60 * 1_000)
  return {
    schemaVersion: 1,
    id,
    deploymentId,
    payload: { kind: "echo", message: "ping" },
    issuedAt: bounds.issuedAt,
    expiresAt: bounds.expiresAt,
    agentVersionMin: null,
    ...overrides,
  }
}

describe("command routes", () => {
  it("agent next → ack round trip via HTTP", async () => {
    const { privateJwk: agentPrivateJwk, keyId } = seedRegisteredDeploymentKeyResult
    const commandId = "99999999-4999-4999-8999-aaaaaaaaaaaa"
    const payload = commandPayload(commandId)
    const farFutureIssuedAt = new Date(Date.now() - 60_000).toISOString()
    const farFutureExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
    const storedPayload = {
      ...payload,
      issuedAt: farFutureIssuedAt,
      expiresAt: farFutureExpiresAt,
    }
    const storedJson = JSON.stringify(storedPayload)
    await env.CONTROL_DB.prepare(
      "INSERT INTO deployment_command_queue (id, deployment_id, vendor_key_id, payload_json, signature, expected_kind, issued_at, expires_at, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    ).bind(
      commandId,
      deploymentId,
      "vendor-key-cmd-route",
      storedJson,
      "stored-signature-placeholder-signature-need-at-least-86-chars-for-the-insert-trigger-validation-row",
      payload.payload.kind,
      farFutureIssuedAt,
      farFutureExpiresAt,
      new Date().toISOString(),
    ).run()
    await env.CONTROL_DB.prepare(
      "INSERT INTO deployment_command_audit (id, deployment_id, command_id, vendor_key_id, expected_kind, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      deploymentId,
      commandId,
      "vendor-key-cmd-route",
      payload.payload.kind,
      farFutureIssuedAt,
      new Date().toISOString(),
    ).run()

    const nextPath = `/v1/deployments/${deploymentId}/commands/next`
    const nextHeaders = await signedHeaders({
      method: "GET",
      path: nextPath,
      body: new Uint8Array(),
      keyId,
      privateKey: agentPrivateJwk,
    })
    const nextResponse = await createApp().fetch(
      new Request(`http://example.com${nextPath}`, { method: "GET", headers: nextHeaders }),
      bindings(),
    )
    expect(nextResponse.status).toBe(200)
    const nextBody = await nextResponse.json() as { id: string; envelope: CommandEnvelope }
    expect(nextBody.id).toBe(commandId)

    const ackPath = `/v1/deployments/${deploymentId}/commands/${commandId}/ack`
    const ackBody = JSON.stringify({
      commandId,
      deploymentId,
      status: "ok",
      outcome: "completed",
      output: null,
      errorCode: null,
      errorMessage: null,
      artifact: null,
      completedAt: new Date("2026-08-19T00:02:00.000Z").toISOString(),
      agentVersion: "1.0.0",
    })
    const ackHeaders = await signedHeaders({
      method: "POST",
      path: ackPath,
      body: ackBody,
      keyId,
      privateKey: agentPrivateJwk,
    })
    ackHeaders.set("Content-Type", "application/json")
    const ackResponse = await createApp().fetch(
      new Request(`http://example.com${ackPath}`, { method: "POST", headers: ackHeaders, body: ackBody }),
      bindings(),
    )
    expect(ackResponse.status).toBe(200)
    const stored = await readCommandEnvelope(env.CONTROL_DB, commandId)
    expect(stored?.state).toBe("acked")
    const history = await getCommandHistory(env.CONTROL_DB, deploymentId)
    expect(history.find((item) => item.id === commandId)?.outcome).toBe("completed")
  })

  it("rejects requests signed with the wrong deployment key", async () => {
    const { privateJwk: agentPrivateJwk, keyId } = seedRegisteredDeploymentKeyResult
    const path = `/v1/deployments/${deploymentId}/commands/next`
    const tampered = `${keyId.slice(0, -1)}${keyId.slice(-1) === "a" ? "b" : "a"}`
    const headers = await signedHeaders({
      method: "GET",
      path,
      body: new Uint8Array(),
      keyId: tampered,
      privateKey: agentPrivateJwk,
    })
    const response = await createApp().fetch(
      new Request(`http://example.com${path}`, { method: "GET", headers }),
      bindings(),
    )
    expect(response.status).toBe(401)
  })
})
