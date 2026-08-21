import {
  commandTtlBounds,
  signCommandEnvelope,
  type CommandAck,
  type CommandEnvelope,
  type CommandEnvelopePayload,
  type CommandPayload,
  CommandPayloadSchema,
} from "@crm/control-protocol"

import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, conflict, notFound, SafeHttpError } from "../http/errors"
import type { MutationActor } from "./clients"

const MAX_COMMAND_QUEUE_BATCH = 16

interface CommandQueueRow {
  id: string
  deployment_id: string
  vendor_key_id: string
  payload_json: string
  signature: string
  expected_kind: string
  issued_at: string
  expires_at: string
  state: "pending" | "in_flight" | "acked" | "expired" | "cancelled"
  created_at: string
  claimed_at: string | null
  claimed_by_actor: string | null
  completed_at: string | null
  ack_payload_json: string | null
  ack_outcome: string | null
  ack_error_code: string | null
  artifact_kind: string | null
  artifact_sha256: string | null
  artifact_storage_key: string | null
  artifact_byte_length: number | null
  operator_id: string | null
  operator_request_id: string | null
}

export interface CommandQueueEntry {
  id: string
  deploymentId: string
  vendorKeyId: string
  envelope: CommandEnvelope
  payload: CommandEnvelopePayload
  expectedKind: string
  issuedAt: string
  expiresAt: string
  state: "pending" | "in_flight" | "acked" | "expired" | "cancelled"
  createdAt: string
  claimedAt: string | null
  completedAt: string | null
}

export interface CommandHistoryItem {
  id: string
  commandId: string
  deploymentId: string
  vendorKeyId: string
  expectedKind: string
  issuedAt: string
  enqueuedAt: string
  ackedAt: string | null
  outcome: string | null
  errorCode: string | null
  artifactKind: string | null
  enqueuedByOperatorId: string | null
  state: "pending" | "in_flight" | "acked" | "expired" | "cancelled"
}

export type CommandRequest = {
  database: D1Database
  deploymentId: string
  payload: CommandPayload
  actor: MutationActor
  signingKeyId: string
  signingPrivateJwk: JsonWebKey
  now?: Date
}

/**
 * Create and queue a server-signed diagnostic command. The private key is
 * supplied by the Worker binding and never enters a request or rendered page.
 */
export async function issueCommand(input: CommandRequest): Promise<{ id: string; createdAt: string; kind: string }> {
  const now = input.now ?? new Date()
  const id = crypto.randomUUID()
  const bounds = commandTtlBounds(now)
  const payload: CommandEnvelopePayload = {
    schemaVersion: 1,
    id,
    deploymentId: input.deploymentId,
    payload: CommandPayloadSchema.parse(input.payload),
    issuedAt: bounds.issuedAt,
    expiresAt: bounds.expiresAt,
    agentVersionMin: null,
  }
  const envelope = await signCommandEnvelope({
    payload,
    keyId: input.signingKeyId,
    privateKey: input.signingPrivateJwk,
  })
  const result = await enqueueCommand(input.database, { envelope, actor: input.actor })
  return { ...result, kind: payload.payload.kind }
}

export async function cancelCommand(
  database: D1Database,
  deploymentId: string,
  commandId: string,
  actor: MutationActor,
): Promise<void> {
  const result = await database.prepare(
    "UPDATE deployment_command_queue SET state = 'cancelled', completed_at = ? WHERE id = ? AND deployment_id = ? AND state IN ('pending', 'in_flight')",
  ).bind(new Date().toISOString(), commandId, deploymentId).run()
  if ((result.meta?.changes ?? 0) === 0) {
    const existing = await readCommandEnvelope(database, commandId)
    if (existing?.deploymentId !== deploymentId) throw notFound()
    throw conflict()
  }
  await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "deployment.command.cancel",
    targetType: "deployment",
    targetId: deploymentId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { commandId },
  }).then(({ statement }) => statement.run())
}

export async function retryCommand(input: Omit<CommandRequest, "payload"> & { commandId: string }): Promise<{ id: string; createdAt: string; kind: string }> {
  const existing = await readCommandEnvelope(input.database, input.commandId)
  if (existing === null || existing.deploymentId !== input.deploymentId) throw notFound()
  if (existing.state === "pending" || existing.state === "in_flight") throw conflict()
  return issueCommand({ ...input, payload: existing.payload.payload })
}

function rowToEntry(row: CommandQueueRow): CommandQueueEntry | null {
  const envelope = parseEnvelope(row)
  if (envelope === null) return null
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    vendorKeyId: row.vendor_key_id,
    envelope,
    payload: envelope.payload,
    expectedKind: row.expected_kind,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    state: row.state,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
  }
}

function parseEnvelope(row: CommandQueueRow): CommandEnvelope | null {
  let payload: CommandEnvelopePayload
  try {
    const candidate = JSON.parse(row.payload_json) as unknown
    if (!isCommandEnvelopePayload(candidate)) return null
    payload = candidate
  } catch {
    return null
  }
  return {
    keyId: row.vendor_key_id,
    payload,
    signature: row.signature,
  }
}

function isCommandEnvelopePayload(value: unknown): value is CommandEnvelopePayload {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    typeof record.id === "string" &&
    typeof record.deploymentId === "string" &&
    typeof record.issuedAt === "string" &&
    typeof record.expiresAt === "string" &&
    isCommandPayload(record.payload)
  )
}

function isCommandPayload(value: unknown): value is CommandPayload {
  return CommandPayloadSchema.safeParse(value).success
}

export interface EnqueueCommandInput {
  envelope: CommandEnvelope
  actor: MutationActor | null
}

export async function enqueueCommand(
  database: D1Database,
  input: EnqueueCommandInput,
): Promise<{ id: string; createdAt: string }> {
  const envelope = input.envelope
  if (envelope.payload.id.length !== 36 || envelope.payload.deploymentId.length !== 36) {
    throw badRequest("command_envelope_id_invalid")
  }
  const id = envelope.payload.id
  const createdAt = new Date().toISOString()
  if (!Number.isFinite(Date.parse(envelope.payload.issuedAt))) {
    throw badRequest("command_envelope_timestamps_invalid")
  }
  if (!Number.isFinite(Date.parse(envelope.payload.expiresAt))) {
    throw badRequest("command_envelope_timestamps_invalid")
  }

  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: input.actor?.operatorId ?? null,
    action: "deployment.command.enqueue",
    targetType: "deployment",
    targetId: envelope.payload.deploymentId,
    outcome: "success",
    requestId: input.actor?.requestId ?? crypto.randomUUID(),
    metadata: {
      commandId: id,
      expectedKind: envelope.payload.payload.kind,
      vendorKeyId: envelope.keyId,
    },
    createdAt,
  })
  try {
    await database.batch([
      database.prepare(
        "INSERT INTO deployment_command_queue (id, deployment_id, vendor_key_id, payload_json, signature, expected_kind, issued_at, expires_at, state, created_at, operator_id, operator_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
      ).bind(
        id,
        envelope.payload.deploymentId,
        envelope.keyId,
        JSON.stringify(envelope.payload),
        envelope.signature,
        envelope.payload.payload.kind,
        envelope.payload.issuedAt,
        envelope.payload.expiresAt,
        createdAt,
        input.actor?.operatorId ?? null,
        input.actor?.requestId ?? null,
      ),
      database.prepare(
        "INSERT INTO deployment_command_audit (id, deployment_id, command_id, vendor_key_id, expected_kind, enqueued_by_operator_id, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        envelope.payload.deploymentId,
        id,
        envelope.keyId,
        envelope.payload.payload.kind,
        input.actor?.operatorId ?? null,
        envelope.payload.issuedAt,
        createdAt,
      ),
      audit.statement,
    ])
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new SafeHttpError(409, "command_already_enqueued")
    }
    if (String(error).includes("FOREIGN KEY constraint failed")) {
      throw notFound()
    }
    if (String(error).includes("command queue entry is invalid")) {
      throw badRequest("command_envelope_invalid")
    }
    throw error
  }
  return { id, createdAt }
}

export async function claimNextPendingCommand(
  database: D1Database,
  deploymentId: string,
  now: string,
): Promise<CommandQueueEntry | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deploymentId)) {
    throw badRequest()
  }
  const claimAndExpire = await database.batch([
    database.prepare(
      "SELECT id FROM deployment_command_queue WHERE deployment_id = ? AND state = 'pending' AND expires_at > ? ORDER BY created_at ASC, id ASC LIMIT 1",
    ).bind(deploymentId, now),
    database.prepare(
      "UPDATE deployment_command_queue SET state = 'expired', completed_at = ? WHERE state = 'pending' AND expires_at <= ?",
    ).bind(now, now),
  ])
  const claimed = (claimAndExpire[0] as { results: Array<{ id: string }> } | undefined)?.results?.[0]
  if (!claimed) return null
  await database.prepare(
    "UPDATE deployment_command_queue SET state = 'in_flight', claimed_at = ?, claimed_by_actor = ? WHERE id = ? AND state = 'pending'",
  ).bind(now, "agent", claimed.id).run()
  const updated = await database
    .prepare("SELECT * FROM deployment_command_queue WHERE id = ?")
    .bind(claimed.id)
    .first<CommandQueueRow>()
  if (!updated) return null
  return rowToEntry(updated)
}

export interface AckCommandInput {
  commandId: string
  deploymentId: string
  ack: CommandAck
}

export async function acknowledgeCommand(
  database: D1Database,
  input: AckCommandInput,
): Promise<{ id: string; completedAt: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.commandId)) {
    throw badRequest("command_id_invalid")
  }
  const ackPayload = JSON.stringify(input.ack)
  const completedAt = new Date().toISOString()
  const result = await database.prepare(
    `UPDATE deployment_command_queue
       SET state = 'acked',
           ack_payload_json = ?,
           ack_outcome = ?,
           ack_error_code = ?,
           artifact_kind = ?,
           artifact_sha256 = ?,
           artifact_storage_key = ?,
           artifact_byte_length = ?,
           completed_at = ?
     WHERE id = ? AND deployment_id = ? AND state = 'in_flight'
     RETURNING id`,
  ).bind(
    ackPayload,
    input.ack.outcome,
    input.ack.errorCode,
    input.ack.artifact?.kind ?? null,
    input.ack.artifact?.sha256 ?? null,
    input.ack.artifact?.storageKey ?? null,
    input.ack.artifact?.byteLength ?? null,
    completedAt,
    input.commandId,
    input.deploymentId,
  ).first<{ id: string }>()
  if (!result) throw new SafeHttpError(409, "command_not_claimable")
  await database.prepare(
    `UPDATE deployment_command_audit
       SET ack_received_at = ?,
           outcome = ?,
           error_code = ?,
           artifact_kind = ?
     WHERE command_id = ?`,
  ).bind(
    completedAt,
    input.ack.outcome,
    input.ack.errorCode,
    input.ack.artifact?.kind ?? null,
    input.commandId,
  ).run()
  return { id: result.id, completedAt }
}

export async function expireDueCommands(
  database: D1Database,
  now: string,
): Promise<number> {
  const result = await database
    .prepare(
      "UPDATE deployment_command_queue SET state = 'expired', completed_at = ? WHERE state IN ('pending', 'in_flight') AND expires_at <= ? RETURNING id",
    )
    .bind(now, now)
    .all<{ id: string }>()
  return result.results.length
}

export async function getCommandHistory(
  database: D1Database,
  deploymentId: string,
  limit = 50,
): Promise<CommandHistoryItem[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deploymentId)) {
    throw badRequest()
  }
  const bounded = Math.min(Math.max(1, Math.floor(limit)), MAX_COMMAND_QUEUE_BATCH * 4)
  const rows = await database.prepare(
    `SELECT q.id, q.id AS command_id, q.deployment_id, q.vendor_key_id, q.expected_kind, q.issued_at, q.created_at, q.completed_at, q.ack_outcome, q.ack_error_code, q.artifact_kind, q.operator_id, q.state
       FROM deployment_command_queue q
      WHERE q.deployment_id = ?
      ORDER BY q.issued_at DESC, q.id DESC
      LIMIT ?`,
  ).bind(deploymentId, bounded).all<{
    id: string
    command_id: string
    deployment_id: string
    vendor_key_id: string
    expected_kind: string
    issued_at: string
    created_at: string
    completed_at: string | null
    ack_outcome: string | null
    ack_error_code: string | null
    artifact_kind: string | null
    operator_id: string | null
    state: string
  }>()
  return rows.results.map((row) => ({
    id: row.id,
    commandId: row.command_id,
    deploymentId: row.deployment_id,
    vendorKeyId: row.vendor_key_id,
    expectedKind: row.expected_kind,
    issuedAt: row.issued_at,
    enqueuedAt: row.created_at,
    ackedAt: row.completed_at,
    outcome: row.ack_outcome,
    errorCode: row.ack_error_code,
    artifactKind: row.artifact_kind,
    enqueuedByOperatorId: row.operator_id,
    state: row.state as CommandHistoryItem["state"],
  }))
}

export async function readCommandEnvelope(
  database: D1Database,
  commandId: string,
): Promise<CommandQueueEntry | null> {
  const row = await database.prepare(
    "SELECT * FROM deployment_command_queue WHERE id = ?",
  ).bind(commandId).first<CommandQueueRow>()
  if (!row) return null
  return rowToEntry(row)
}
