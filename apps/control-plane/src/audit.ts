export const MAX_AUDIT_METADATA_BYTES = 8_192

const MAX_AUDIT_DEPTH = 6
const MAX_AUDIT_NODES = 512
const MAX_AUDIT_STRING_LENGTH = 2_048
const sensitiveKeyPattern =
  /authorization|bearer|cookie|credential|password|passwd|secret|token|apikey|accesskey|private(?:key|jwk)|signingkey|encryptionkey|accessjwt|jwtassertion/

export type AuditOutcome = "success" | "denied" | "error"
type AuditPrimitive = boolean | number | string | null
export type AuditValue = AuditPrimitive | AuditValue[] | { [key: string]: AuditValue }

export interface OperatorAuditEvent {
  operatorId: string | null
  action: string
  targetType: string
  targetId: string
  outcome: AuditOutcome
  requestId: string
  metadata?: AuditValue
  createdAt?: string
}

interface PreparedAuditRecord {
  id: string
  operatorId: string | null
  action: string
  targetType: string
  targetId: string
  outcome: AuditOutcome
  requestIdHash: string
  metadataJson: string
  createdAt: string
}

function assertBoundedLabel(value: string, name: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} is invalid`)
  }
}

function canonicalize(value: unknown, depth: number, state: { nodes: number }): AuditValue {
  state.nodes += 1
  if (state.nodes > MAX_AUDIT_NODES || depth > MAX_AUDIT_DEPTH) {
    throw new TypeError("Audit metadata exceeds structural limit")
  }

  if (value === null || typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    if (value.length > MAX_AUDIT_STRING_LENGTH) {
      throw new TypeError("Audit metadata exceeds string limit")
    }
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Audit metadata contains unsupported number")
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, depth + 1, state))
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Audit metadata contains unsupported value")
    }

    const canonical: Record<string, AuditValue> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (sensitiveKeyPattern.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) {
        throw new TypeError("Audit metadata contains sensitive field")
      }
      canonical[key] = canonicalize(
        (value as Record<string, unknown>)[key],
        depth + 1,
        state,
      )
    }
    return canonical
  }

  throw new TypeError("Audit metadata contains unsupported value")
}

export function sanitizeAuditMetadata(metadata: AuditValue = {}): string {
  const canonical = canonicalize(metadata, 0, { nodes: 0 })
  const serialized = JSON.stringify(canonical)

  if (new TextEncoder().encode(serialized).byteLength > MAX_AUDIT_METADATA_BYTES) {
    throw new TypeError("Audit metadata exceeds byte limit")
  }

  return serialized
}

export async function hashAuditRequestId(requestId: string): Promise<string> {
  assertBoundedLabel(requestId, "requestId", 1_024)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestId))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function prepareAuditRecord(event: OperatorAuditEvent): Promise<PreparedAuditRecord> {
  assertBoundedLabel(event.action, "action", 128)
  assertBoundedLabel(event.targetType, "targetType", 128)
  assertBoundedLabel(event.targetId, "targetId", 256)

  return {
    id: crypto.randomUUID(),
    operatorId: event.operatorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    outcome: event.outcome,
    requestIdHash: await hashAuditRequestId(event.requestId),
    metadataJson: sanitizeAuditMetadata(event.metadata),
    createdAt: event.createdAt ?? new Date().toISOString(),
  }
}

export async function prepareOperatorAuditStatement(
  database: D1Database,
  event: OperatorAuditEvent,
): Promise<{ id: string; statement: D1PreparedStatement }> {
  const record = await prepareAuditRecord(event)
  const statement = database
    .prepare(
      "INSERT INTO operator_audit_log (id, operator_id, action, target_type, target_id, outcome, request_id_hash, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      record.id,
      record.operatorId,
      record.action,
      record.targetType,
      record.targetId,
      record.outcome,
      record.requestIdHash,
      record.metadataJson,
      record.createdAt,
    )

  return { id: record.id, statement }
}

export async function writeOperatorAudit(
  database: D1Database,
  event: OperatorAuditEvent,
): Promise<string> {
  const { id, statement } = await prepareOperatorAuditStatement(database, event)
  await statement.run()

  return id
}
