import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest"

import {
  type CommandAck,
  type CommandEnvelope,
  type CommandEnvelopePayload,
  commandTtlBounds,
  signCommandEnvelope,
} from "@crm/control-protocol"
import { readCommandEnvelope } from "../src/repos/commands"
import {
  acknowledgeCommand,
  claimNextPendingCommand,
  enqueueCommand,
  expireDueCommands,
  getCommandHistory,
} from "../src/repos/commands"

import { type MutationActor } from "../src/repos/clients"

const DAY_MS = 24 * 60 * 60 * 1_000

const encoder = new TextEncoder()
const commandId = "11111111-4111-4111-8111-111111111111"
const otherCommandId = "22222222-4222-4222-8222-222222222222"
const clientId = "33333333-4333-4333-8333-333333333333"
const deploymentId = "44444444-4444-4444-8444-444444444444"
const contractId = "55555555-4555-4555-8555-555555555555"

const operatorActor: MutationActor = {
  operatorId: "99999999-4999-4999-8999-999999999999",
  requestId: "ops-request-1",
}

let migrations: D1Migration[]
let privateJwk: JsonWebKey
let publicJwk: JsonWebKey

function bindings(database: D1Database = env.CONTROL_DB): CloudflareBindings {
  return {
    ...env,
    CONTROL_DB: database,
    ENVIRONMENT: "test",
    ENTITLEMENT_SIGNING_KEY_ID: "vendor-key-cmd",
    ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk),
  } as unknown as CloudflareBindings
}

async function signCommand(
  payload: CommandEnvelopePayload,
  signingKey: JsonWebKey,
  keyId: string,
): Promise<CommandEnvelope> {
  return signCommandEnvelope({
    payload,
    keyId,
    privateKey: signingKey,
  })
}

function commandPayload(overrides: Partial<CommandEnvelopePayload> = {}): CommandEnvelopePayload {
  const bounds = commandTtlBounds(new Date("2026-08-19T00:00:00.000Z"), 5 * 60 * 1_000)
  return {
    schemaVersion: 1,
    id: commandId,
    deploymentId,
    payload: { kind: "echo", message: "ping" },
    issuedAt: bounds.issuedAt,
    expiresAt: bounds.expiresAt,
    agentVersionMin: null,
    ...overrides,
  }
}

async function seedDeployment(): Promise<void> {
  const now = new Date("2026-08-19T00:00:00.000Z").toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Client', 'active', ?, ?)")
      .bind(clientId, `client-${clientId}`, now, now),
    env.CONTROL_DB.prepare("INSERT INTO deployments (id, client_id, deployment_key, environment, status, registered_at, registration_key_fingerprint, created_at, updated_at) VALUES (?, ?, ?, 'production', 'active', NULL, NULL, ?, ?)")
      .bind(deploymentId, clientId, `dep-${deploymentId}`, now, now),
    env.CONTROL_DB.prepare("INSERT INTO operator_users (id, email, access_subject, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .bind(operatorActor.operatorId, "ops@example.com", "sub-ops-cmd", now, now),
  ])
}

beforeAll(async () => {
  migrations = inject("migrations") as D1Migration[]
  await applyD1Migrations(env.CONTROL_DB, migrations)
  await seedDeployment()
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
  privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
})

beforeEach(async () => {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("DELETE FROM deployment_command_audit"),
    env.CONTROL_DB.prepare("DELETE FROM deployment_command_queue"),
  ])
})

describe("command enqueue", () => {
  it("accepts a valid signed envelope and stores both the queue and audit row", async () => {
    const payload = commandPayload()
    const envelope = await signCommand(payload, privateJwk, "vendor-key-cmd")
    const result = await enqueueCommand(env.CONTROL_DB, {
      envelope,
      actor: operatorActor,
    })
    expect(result.id).toBe(commandId)
    const stored = await readCommandEnvelope(env.CONTROL_DB, commandId)
    expect(stored?.state).toBe("pending")
    expect(stored?.expectedKind).toBe("echo")
    expect(stored?.envelope.payload.payload).toEqual({ kind: "echo", message: "ping" })
  })

  it("rejects duplicate enqueue for the same command ID", async () => {
    const payload = commandPayload({ id: otherCommandId })
    const envelope = await signCommand(payload, privateJwk, "vendor-key-cmd")
    await enqueueCommand(env.CONTROL_DB, { envelope, actor: operatorActor })
    await expect(enqueueCommand(env.CONTROL_DB, { envelope, actor: operatorActor })).rejects.toThrow()
  })

  it("rejects malformed id/issuedAt/expiresAt fields", async () => {
    const payload = commandPayload()
    const envelope = await signCommand(payload, privateJwk, "vendor-key-cmd")
    const mutated = {
      ...envelope,
      payload: { ...envelope.payload, id: "not-a-uuid" },
    }
    await expect(enqueueCommand(env.CONTROL_DB, { envelope: mutated as typeof envelope, actor: null })).rejects.toThrow()
  })
})

describe("command claim/ack round trip", () => {
  it("claims the oldest pending command and updates the state to in_flight", async () => {
    const candidate = commandPayload({ id: "55555555-4555-4555-8555-555555555555" })
    const envelope = await signCommand(candidate, privateJwk, "vendor-key-cmd")
    await enqueueCommand(env.CONTROL_DB, { envelope, actor: operatorActor })
    const claimed = await claimNextPendingCommand(env.CONTROL_DB, deploymentId, new Date("2026-08-19T00:01:00.000Z").toISOString())
    expect(claimed?.id).toBe(candidate.id)
    expect(claimed?.state).toBe("in_flight")
    expect(claimed?.claimedAt).toBeTruthy()
  })

  it("expires commands whose expiresAt is past while polling", async () => {
    const candidate = commandPayload({
      id: "66666666-4666-4666-8666-666666666666",
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-19T00:01:00.000Z",
    })
    const envelope = await signCommand(candidate, privateJwk, "vendor-key-cmd")
    await enqueueCommand(env.CONTROL_DB, { envelope, actor: operatorActor })
    const claimed = await claimNextPendingCommand(env.CONTROL_DB, deploymentId, new Date("2026-08-19T00:00:30.000Z").toISOString())
    expect(claimed?.id).toBe(candidate.id)
    const expiryRun = await expireDueCommands(env.CONTROL_DB, new Date("2026-08-19T00:02:00.000Z").toISOString())
    expect(expiryRun).toBeGreaterThan(0)
    const reloaded = await readCommandEnvelope(env.CONTROL_DB, candidate.id)
    expect(reloaded?.state).toBe("expired")
  })

  it("acknowledges a claimed command and rejects double ack", async () => {
    const candidate = commandPayload({
      id: "77777777-4777-4777-8777-777777777777",
      issuedAt: new Date("2026-08-19T00:00:00.000Z").toISOString(),
      expiresAt: new Date("2026-08-19T00:05:00.000Z").toISOString(),
    })
    const envelope = await signCommand(candidate, privateJwk, "vendor-key-cmd")
    await enqueueCommand(env.CONTROL_DB, { envelope, actor: operatorActor })
    const claimed = await claimNextPendingCommand(env.CONTROL_DB, deploymentId, new Date("2026-08-19T00:00:30.000Z").toISOString())
    expect(claimed?.state).toBe("in_flight")
    const ack: CommandAck = {
      commandId: candidate.id,
      deploymentId: candidate.deploymentId,
      status: "ok",
      outcome: "completed",
      output: { received: candidate.payload.kind },
      errorCode: null,
      errorMessage: null,
      artifact: null,
      completedAt: new Date("2026-08-19T00:00:35.000Z").toISOString(),
      agentVersion: "1.0.0",
    }
    await acknowledgeCommand(env.CONTROL_DB, {
      commandId: candidate.id,
      deploymentId,
      ack,
    })
    const stored = await readCommandEnvelope(env.CONTROL_DB, candidate.id)
    expect(stored?.state).toBe("acked")
    await expect(acknowledgeCommand(env.CONTROL_DB, {
      commandId: candidate.id,
      deploymentId,
      ack,
    })).rejects.toThrow("command_not_claimable")
  })

  it("returns the per-deployment history newest-first", async () => {
    const first = await signCommand(commandPayload({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), privateJwk, "vendor-key-cmd")
    const second = await signCommand(commandPayload({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), privateJwk, "vendor-key-cmd")
    await enqueueCommand(env.CONTROL_DB, { envelope: first, actor: operatorActor })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await enqueueCommand(env.CONTROL_DB, { envelope: second, actor: operatorActor })
    const history = await getCommandHistory(env.CONTROL_DB, deploymentId, 10)
    expect(history.length).toBeGreaterThan(0)
    for (const item of history) {
      expect(item.deploymentId).toBe(deploymentId)
    }
    const sorted = [...history].sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt))
    expect(history.map((item) => item.enqueuedAt)).toEqual(sorted.map((item) => item.enqueuedAt))
  })
})

describe("command queue cleanup", () => {
  it("releases nothing when no expired rows remain", async () => {
    const empty = await expireDueCommands(env.CONTROL_DB, new Date("2030-01-01T00:00:00.000Z").toISOString())
    expect(empty).toBe(0)
  })
})
