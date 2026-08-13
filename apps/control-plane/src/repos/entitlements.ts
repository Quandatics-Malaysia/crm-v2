import {
  EntitlementLeaseSchema,
  LegacyEntitlementLeaseSchema,
  canonicalJson,
  signEnvelope,
  type EntitlementLease,
  type LegacyEntitlementLease,
  type SignedEnvelope,
} from "@crm/control-protocol"

import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, notFound, SafeHttpError } from "../http/errors"
import { MODULE_CATALOG, type ModuleId } from "./contracts"
import type { MutationActor } from "./clients"

const DAY_MS = 24 * 60 * 60 * 1_000
const HEARTBEAT_FRESHNESS_MS = 30 * 60 * 1_000
const RENEWAL_HORIZON_MS = 6 * 60 * 60 * 1_000
const CLAIM_TTL_MS = 2 * 60 * 1_000
const RENEWAL_BATCH_SIZE = 50
const MAX_RENEWAL_SCANS = 500
const canonicalInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

type ReleaseChannel = "stable" | "beta" | "canary"
type SubscriptionStatus = "active" | "past_due" | "suspended" | "cancelled"

interface EntitlementStateRow {
  deployment_id: string
  deployment_status: string
  registered_at: string | null
  client_id: string
  contract_id: string
  contract_client_id: string
  plan_id: string
  status: SubscriptionStatus
  starts_at: string
  ends_at: string
  seat_limit: number
  renewal_policy: "auto_renew" | "non_renewing"
  suspension_at: string | null
  scheduled_seat_limit: number | null
  seat_limit_effective_at: string | null
  configuration_version: string
  release_channel: ReleaseChannel
  minimum_supported_app_version: string
  approved_image_digest: string | null
  next_check_at: string
  latest_version: number | null
  entitlement_revision: number
  state_revision: number
}

interface StoredEntitlementRow {
  id: string
  deployment_id: string
  contract_id: string
  version: number
  key_id: string
  payload_json: string
  signature: string
  envelope_json: string | null
  issuance_key: string | null
  issued_at: string
}

class DeploymentUnavailableError extends Error {
  readonly snapshot: EntitlementStateRow

  constructor(snapshot: EntitlementStateRow) {
    super("Deployment is unavailable")
    this.snapshot = snapshot
  }
}

type StoredEntitlementLease = EntitlementLease | LegacyEntitlementLease

export interface EntitlementRecord {
  id: string
  deploymentId: string
  contractId: string
  version: number
  keyId: string
  issuanceKey: string | null
  envelope: SignedEnvelope<StoredEntitlementLease>
  envelopeJson: string
  issuedAt: string
}

export interface ScheduleInput {
  deploymentId: string
  contractId: string
  configurationVersion: string
  releaseChannel: ReleaseChannel
  minimumSupportedAppVersion: string
  approvedImageDigest?: string | null
}

export interface EntitlementControlInput {
  status?: SubscriptionStatus
  renewalPolicy?: "auto_renew" | "non_renewing"
  suspensionAt?: string | null
  seatLimit?: number
  effectiveAt?: string
}

export interface EntitlementActor {
  operatorId: string | null
  requestId: string
  source?: "operator" | "scheduled"
}

function assertInstant(value: string): number {
  const parsed = Date.parse(value)
  if (!canonicalInstant.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw badRequest()
  }
  return parsed
}

function dayStart(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest()
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw badRequest()
  return parsed
}

function contractBounds(row: Pick<EntitlementStateRow, "starts_at" | "ends_at">) {
  const startsAt = dayStart(row.starts_at)
  const endsAt = dayStart(row.ends_at) + DAY_MS
  if (endsAt <= startsAt) throw badRequest()
  return { startsAt, endsAt }
}

function boundedValue(value: string, maximum: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maximum || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw badRequest()
  }
  return trimmed
}

function validateScheduleInput(input: ScheduleInput): void {
  boundedValue(input.configurationVersion, 128)
  boundedValue(input.minimumSupportedAppVersion, 64)
  if (!(["stable", "beta", "canary"] as const).includes(input.releaseChannel)) throw badRequest()
  if (input.approvedImageDigest !== undefined && input.approvedImageDigest !== null &&
      !/^sha256:[a-f0-9]{64}$/.test(input.approvedImageDigest)) throw badRequest()
}

export async function assignEntitlementSchedule(
  database: D1Database,
  input: ScheduleInput,
  actor: MutationActor,
  now = new Date(),
): Promise<void> {
  validateScheduleInput(input)
  const row = await database.prepare(
    "SELECT d.client_id AS deployment_client_id, d.status AS deployment_status, c.client_id AS contract_client_id FROM deployments d JOIN contracts c ON c.id = ? WHERE d.id = ?",
  ).bind(input.contractId, input.deploymentId).first<{
    deployment_client_id: string
    deployment_status: string
    contract_client_id: string
  }>()
  if (!row) throw notFound()
  if (row.deployment_client_id !== row.contract_client_id || row.deployment_status !== "active") throw badRequest()
  const at = now.toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "entitlement.schedule.assign",
    targetType: "deployment",
    targetId: input.deploymentId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { contractId: input.contractId, releaseChannel: input.releaseChannel },
    createdAt: at,
  })
  await database.batch([
    database.prepare(
      "INSERT INTO deployment_entitlement_schedules (deployment_id, contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1, ?) ON CONFLICT(deployment_id) DO UPDATE SET contract_id = excluded.contract_id, next_check_at = excluded.next_check_at, configuration_version = excluded.configuration_version, release_channel = excluded.release_channel, minimum_supported_app_version = excluded.minimum_supported_app_version, approved_image_digest = excluded.approved_image_digest, state_revision = deployment_entitlement_schedules.state_revision + 1, updated_at = excluded.updated_at",
    ).bind(
      input.deploymentId,
      input.contractId,
      at,
      input.configurationVersion,
      input.releaseChannel,
      input.minimumSupportedAppVersion,
      input.approvedImageDigest ?? null,
      at,
    ),
    audit.statement,
  ])
}

async function affectedDeployments(database: D1Database, contractId: string): Promise<string[]> {
  const rows = await database.prepare(
    "SELECT deployment_id FROM deployment_entitlement_schedules WHERE contract_id = ? ORDER BY deployment_id",
  ).bind(contractId).all<{ deployment_id: string }>()
  return rows.results.map((row) => row.deployment_id)
}

async function validateImmediateSeatReduction(
  database: D1Database,
  deploymentIds: readonly string[],
  seatLimit: number,
  now: Date,
): Promise<void> {
  if (deploymentIds.length === 0) throw badRequest()
  for (const deploymentId of deploymentIds) {
    const heartbeat = await database.prepare(
      "SELECT observed_at, health_status, active_user_count, reserved_invitation_count FROM heartbeat_rollups WHERE deployment_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{
      observed_at: string
      health_status: string
      active_user_count: number | null
      reserved_invitation_count: number | null
    }>()
    const observedAt = heartbeat ? Date.parse(heartbeat.observed_at) : Number.NaN
    if (!heartbeat || heartbeat.health_status !== "healthy" || heartbeat.active_user_count === null ||
        heartbeat.reserved_invitation_count === null || !Number.isFinite(observedAt) ||
        observedAt > now.getTime() || now.getTime() - observedAt > HEARTBEAT_FRESHNESS_MS ||
        heartbeat.active_user_count + heartbeat.reserved_invitation_count > seatLimit) {
      throw badRequest()
    }
  }
}

export async function updateEntitlementControls(
  database: D1Database,
  contractId: string,
  input: EntitlementControlInput,
  actor: MutationActor,
  now = new Date(),
): Promise<void> {
  if (!Object.values(input).some((value) => value !== undefined)) throw badRequest()
  const contract = await database.prepare(
    "SELECT status, starts_at, ends_at, seat_limit, renewal_policy, suspension_at, scheduled_seat_limit, seat_limit_effective_at, entitlement_revision FROM contracts WHERE id = ?",
  ).bind(contractId).first<{
    status: SubscriptionStatus
    starts_at: string
    ends_at: string
    seat_limit: number
    renewal_policy: "auto_renew" | "non_renewing"
    suspension_at: string | null
    scheduled_seat_limit: number | null
    seat_limit_effective_at: string | null
    entitlement_revision: number
  }>()
  if (!contract) throw notFound()
  if (input.status !== undefined && !["active", "past_due", "suspended", "cancelled"].includes(input.status)) throw badRequest()
  if (input.renewalPolicy !== undefined && !["auto_renew", "non_renewing"].includes(input.renewalPolicy)) throw badRequest()
  const bounds = contractBounds(contract)
  if (input.suspensionAt !== undefined && input.suspensionAt !== null) {
    const suspension = assertInstant(input.suspensionAt)
    if (suspension <= now.getTime() || suspension < bounds.startsAt || suspension >= bounds.endsAt) throw badRequest()
  }
  let seatLimit = contract.seat_limit
  const status = input.status ?? contract.status
  const suspensionAt = input.status === "suspended"
    ? null
    : input.suspensionAt === undefined ? contract.suspension_at : input.suspensionAt
  let scheduledSeatLimit = contract.scheduled_seat_limit
  let seatLimitEffectiveAt = contract.seat_limit_effective_at
  const deployments = await affectedDeployments(database, contractId)
  if (input.seatLimit !== undefined) {
    if (!Number.isInteger(input.seatLimit) || input.seatLimit < 1 || input.seatLimit > 100_000 || input.seatLimit >= contract.seat_limit) throw badRequest()
    if (input.effectiveAt === undefined) {
      await validateImmediateSeatReduction(database, deployments, input.seatLimit, now)
      seatLimit = input.seatLimit
      scheduledSeatLimit = null
      seatLimitEffectiveAt = null
    } else {
      const effective = assertInstant(input.effectiveAt)
      if (effective <= now.getTime()) throw badRequest()
      scheduledSeatLimit = input.seatLimit
      seatLimitEffectiveAt = input.effectiveAt
    }
  } else if (input.effectiveAt !== undefined) {
    throw badRequest()
  }
  const at = now.toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "entitlement.controls.update",
    targetType: "contract",
    targetId: contractId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: {
      renewalPolicy: input.renewalPolicy ?? contract.renewal_policy,
      status,
      suspensionScheduled: suspensionAt !== null,
      seatLimit,
      scheduledSeatLimit,
      seatLimitEffectiveAt,
    },
    createdAt: at,
  })
  const statements: D1PreparedStatement[] = [
    database.prepare(
      "INSERT INTO entitlement_control_operations (id, contract_id, expected_revision, created_at) VALUES (?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), contractId, contract.entitlement_revision, at),
  ]
  if (input.status !== undefined) {
    statements.push(database.prepare(
      "UPDATE contracts SET status = ?, suspension_at = CASE WHEN ? = 'suspended' THEN NULL ELSE suspension_at END, updated_at = ? WHERE id = ?",
    ).bind(input.status, input.status, at, contractId))
  }
  if (input.renewalPolicy !== undefined) {
    statements.push(database.prepare(
      "UPDATE contracts SET renewal_policy = ?, updated_at = ? WHERE id = ?",
    ).bind(input.renewalPolicy, at, contractId))
  }
  if (input.suspensionAt !== undefined && input.status !== "suspended") {
    statements.push(database.prepare(
      "UPDATE contracts SET suspension_at = ?, updated_at = ? WHERE id = ?",
    ).bind(input.suspensionAt, at, contractId))
  }
  if (input.seatLimit !== undefined) {
    statements.push(database.prepare(
      "UPDATE contracts SET seat_limit = ?, scheduled_seat_limit = ?, seat_limit_effective_at = ?, updated_at = ? WHERE id = ?",
    ).bind(seatLimit, scheduledSeatLimit, seatLimitEffectiveAt, at, contractId))
  }
  statements.push(
    database.prepare(
      "UPDATE contracts SET entitlement_revision = entitlement_revision + 1, updated_at = ? WHERE id = ? AND entitlement_revision = ?",
    ).bind(at, contractId, contract.entitlement_revision),
    database.prepare(
      "UPDATE deployment_entitlement_schedules SET state_revision = state_revision + 1, next_check_at = ?, updated_at = ? WHERE contract_id = ?",
    ).bind(at, at, contractId),
    audit.statement,
  )
  try {
    await database.batch(statements)
  } catch (error) {
    if (error instanceof Error && error.message.includes("contract entitlement revision changed")) {
      throw new SafeHttpError(409, "entitlement_state_changed")
    }
    throw error
  }
}

async function loadState(database: D1Database, deploymentId: string, contractId?: string): Promise<EntitlementStateRow> {
  const row = await database.prepare(
    "SELECT d.id AS deployment_id, d.status AS deployment_status, d.registered_at, d.client_id, s.contract_id, c.client_id AS contract_client_id, c.plan_id, c.status, c.starts_at, c.ends_at, c.seat_limit, c.renewal_policy, c.suspension_at, c.scheduled_seat_limit, c.seat_limit_effective_at, c.entitlement_revision, s.configuration_version, s.release_channel, s.minimum_supported_app_version, s.approved_image_digest, s.next_check_at, s.latest_version, s.state_revision FROM deployment_entitlement_schedules s JOIN deployments d ON d.id = s.deployment_id JOIN contracts c ON c.id = s.contract_id WHERE s.deployment_id = ? AND (? IS NULL OR s.contract_id = ?)",
  ).bind(deploymentId, contractId ?? null, contractId ?? null).first<EntitlementStateRow>()
  if (!row) throw notFound()
  if (row.client_id !== row.contract_client_id) throw badRequest()
  if (row.deployment_status !== "active" || row.registered_at === null) throw new DeploymentUnavailableError(row)
  return row
}

function parseDependencies(value: string): ModuleId[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw badRequest() }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !(item in MODULE_CATALOG))) throw badRequest()
  if (new Set(parsed).size !== parsed.length) throw badRequest()
  return parsed as ModuleId[]
}

async function validatedModules(database: D1Database, contractId: string): Promise<ModuleId[]> {
  const rows = await database.prepare(
    "SELECT cm.module_id, mc.active, mc.dependency_ids_json FROM contract_modules cm LEFT JOIN module_catalog mc ON mc.module_id = cm.module_id WHERE cm.contract_id = ? ORDER BY cm.module_id",
  ).bind(contractId).all<{ module_id: string; active: number | null; dependency_ids_json: string | null }>()
  if (rows.results.length === 0) return []
  const selected = new Set<ModuleId>()
  const graph = new Map<ModuleId, ModuleId[]>()
  for (const row of rows.results) {
    if (!(row.module_id in MODULE_CATALOG) || row.active !== 1 || row.dependency_ids_json === null || selected.has(row.module_id as ModuleId)) throw badRequest()
    const moduleId = row.module_id as ModuleId
    const dependencies = parseDependencies(row.dependency_ids_json)
    const canonicalDependencies = [...MODULE_CATALOG[moduleId].dependencies].sort()
    if (canonicalJson([...dependencies].sort()) !== canonicalJson(canonicalDependencies)) throw badRequest()
    selected.add(moduleId)
    graph.set(moduleId, dependencies)
  }
  const visiting = new Set<ModuleId>()
  const visited = new Set<ModuleId>()
  const visit = (moduleId: ModuleId): void => {
    if (visiting.has(moduleId)) throw badRequest()
    if (visited.has(moduleId)) return
    visiting.add(moduleId)
    for (const dependency of graph.get(moduleId) ?? []) {
      if (!selected.has(dependency)) throw badRequest()
      visit(dependency)
    }
    visiting.delete(moduleId)
    visited.add(moduleId)
  }
  for (const moduleId of selected) visit(moduleId)
  return [...selected].sort()
}

function effectiveState(row: EntitlementStateRow, now: Date): {
  status: SubscriptionStatus
  seatLimit: number
  startsAt: string
  endsAt: string
} {
  const { startsAt, endsAt } = contractBounds(row)
  const time = now.getTime()
  if (!Number.isFinite(time) || time < startsAt) throw badRequest()
  let status = row.status
  if (time >= endsAt) status = "cancelled"
  else if (row.suspension_at !== null && time >= assertInstant(row.suspension_at)) status = "suspended"
  const seatLimit = row.scheduled_seat_limit !== null && row.seat_limit_effective_at !== null &&
    time >= assertInstant(row.seat_limit_effective_at) ? row.scheduled_seat_limit : row.seat_limit
  return {
    status,
    seatLimit,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
  }
}

function privateSigningJwk(environment: CloudflareBindings): JsonWebKey {
  const keyId = boundedValue(environment.ENTITLEMENT_SIGNING_KEY_ID, 128)
  let parsed: unknown
  try { parsed = JSON.parse(environment.ENTITLEMENT_SIGNING_PRIVATE_JWK) } catch { throw new Error("Entitlement signing configuration is unavailable") }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Entitlement signing configuration is unavailable")
  const key = parsed as Record<string, unknown>
  if (key.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || typeof key.d !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.d)) {
    throw new Error("Entitlement signing configuration is unavailable")
  }
  return { kty: "OKP", crv: "Ed25519", x: key.x, d: key.d, key_ops: ["sign"], ext: true, alg: "EdDSA" }
}

async function desiredLease(
  database: D1Database,
  row: EntitlementStateRow,
  keyId: string,
  revision: number,
  now: Date,
): Promise<EntitlementLease> {
  const effective = effectiveState(row, now)
  const issuedAt = now.toISOString()
  const payload = {
    schemaVersion: 2 as const,
    revision,
    keyId,
    leaseId: crypto.randomUUID(),
    clientId: row.client_id,
    deploymentId: row.deployment_id,
    issuedAt,
    leaseExpiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
    contractStartsAt: effective.startsAt,
    contractEndsAt: effective.endsAt,
    graceUntil: new Date(now.getTime() + 8 * DAY_MS).toISOString(),
    subscriptionStatus: effective.status,
    planId: row.plan_id,
    maxActiveUsers: effective.seatLimit,
    moduleIds: await validatedModules(database, row.contract_id),
    addonIds: [],
    configurationVersion: row.configuration_version,
    releaseChannel: row.release_channel,
    minimumSupportedAppVersion: row.minimum_supported_app_version,
    ...(row.approved_image_digest === null ? {} : { approvedImageDigest: row.approved_image_digest }),
  }
  return EntitlementLeaseSchema.parse(payload)
}

async function allocateEntitlementRevision(database: D1Database, deploymentId: string): Promise<number> {
  const allocated = await database.prepare(
    "INSERT INTO deployment_entitlement_sequences (deployment_id, next_version) VALUES (?, 2) ON CONFLICT(deployment_id) DO UPDATE SET next_version = deployment_entitlement_sequences.next_version + 1 RETURNING next_version - 1 AS revision",
  ).bind(deploymentId).first<{ revision: number }>()
  if (!allocated || !Number.isSafeInteger(allocated.revision) || allocated.revision < 1) {
    throw new Error("Entitlement revision allocation failed")
  }
  return allocated.revision
}

function nextCheck(row: EntitlementStateRow, lease: EntitlementLease, now: Date): string {
  const candidates = [Date.parse(lease.leaseExpiresAt) - RENEWAL_HORIZON_MS]
  const { endsAt } = contractBounds(row)
  for (const value of [row.suspension_at, row.seat_limit_effective_at]) {
    if (value !== null) candidates.push(assertInstant(value))
  }
  candidates.push(endsAt)
  const future = candidates.filter((value) => value > now.getTime())
  return new Date(future.length === 0 ? now.getTime() + DAY_MS : Math.min(...future)).toISOString()
}

function fromStored(row: StoredEntitlementRow): EntitlementRecord {
  const envelopeJson = row.envelope_json ?? canonicalJson({
    keyId: row.key_id,
    payload: JSON.parse(row.payload_json) as unknown,
    signature: row.signature,
  })
  const candidate: unknown = JSON.parse(envelopeJson)
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") throw new Error("Stored entitlement is invalid")
  const record = candidate as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !== "keyId,payload,signature" ||
      typeof record.keyId !== "string" || typeof record.signature !== "string") {
    throw new Error("Stored entitlement is invalid")
  }
  const current = EntitlementLeaseSchema.safeParse(record.payload)
  let payload: StoredEntitlementLease
  if (current.success) {
    payload = current.data
  } else {
    const legacy = LegacyEntitlementLeaseSchema.safeParse(record.payload)
    if (!legacy.success) throw new Error("Stored entitlement is invalid")
    payload = legacy.data
  }
  const envelope: SignedEnvelope<StoredEntitlementLease> = {
    keyId: record.keyId,
    payload,
    signature: record.signature,
  }
  if (envelope.keyId !== payload.keyId || envelope.keyId !== row.key_id || envelope.signature !== row.signature ||
      canonicalJson(payload) !== row.payload_json || canonicalJson(envelope) !== envelopeJson) {
    throw new Error("Stored entitlement is invalid")
  }
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    contractId: row.contract_id,
    version: row.version,
    keyId: row.key_id,
    issuanceKey: row.issuance_key,
    envelope,
    envelopeJson,
    issuedAt: row.issued_at,
  }
}

export async function getEntitlement(database: D1Database, deploymentId: string, version: number): Promise<EntitlementRecord | null> {
  if (!Number.isSafeInteger(version) || version < 1) return null
  const row = await database.prepare(
    "SELECT id, deployment_id, contract_id, version, key_id, payload_json, signature, envelope_json, issuance_key, issued_at FROM entitlement_versions WHERE deployment_id = ? AND version = ?",
  ).bind(deploymentId, version).first<StoredEntitlementRow>()
  return row ? fromStored(row) : null
}

export async function getCurrentEntitlementReference(database: D1Database, deploymentId: string): Promise<{ version: number } | null> {
  const row = await database.prepare(
    "SELECT version FROM entitlement_versions WHERE deployment_id = ? ORDER BY version DESC LIMIT 1",
  ).bind(deploymentId).first<{ version: number }>()
  return row ? { version: row.version } : null
}

export async function issueEntitlement(
  environment: CloudflareBindings,
  input: {
    deploymentId: string
    contractId?: string
    issuanceKey: string
    actor: EntitlementActor
    now?: Date
    claimToken?: string
  },
): Promise<EntitlementRecord> {
  const issuanceKey = boundedValue(input.issuanceKey, 256)
  const existing = await environment.CONTROL_DB.prepare(
    "SELECT id, deployment_id, contract_id, version, key_id, payload_json, signature, envelope_json, issuance_key, issued_at FROM entitlement_versions WHERE deployment_id = ? AND issuance_key = ?",
  ).bind(input.deploymentId, issuanceKey).first<StoredEntitlementRow>()
  if (existing) return fromStored(existing)
  const now = input.now ?? new Date()
  const row = await loadState(environment.CONTROL_DB, input.deploymentId, input.contractId)
  const keyId = boundedValue(environment.ENTITLEMENT_SIGNING_KEY_ID, 128)
  const revision = await allocateEntitlementRevision(environment.CONTROL_DB, input.deploymentId)
  const payload = await desiredLease(environment.CONTROL_DB, row, keyId, revision, now)
  const envelope = await signEnvelope(payload, keyId, privateSigningJwk(environment))
  const payloadJson = canonicalJson(payload)
  const envelopeJson = canonicalJson(envelope)
  const id = crypto.randomUUID()
  const auditAction = input.actor.source === "scheduled" ? "entitlement.renew" : "entitlement.issue"
  const audit = await prepareOperatorAuditStatement(environment.CONTROL_DB, {
    operatorId: input.actor.source === "scheduled" ? null : input.actor.operatorId,
    action: auditAction,
    targetType: "deployment",
    targetId: input.deploymentId,
    outcome: "success",
    requestId: input.actor.requestId,
    metadata: { contractId: row.contract_id, keyId, source: input.actor.source ?? "operator" },
    createdAt: now.toISOString(),
  })
  const statements: D1PreparedStatement[] = [
    environment.CONTROL_DB.prepare(
      "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at, issuance_key, envelope_json, contract_revision, schedule_revision, renewal_claim_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, input.deploymentId, row.contract_id, revision, keyId, payloadJson, envelope.signature, now.toISOString(), now.toISOString(), issuanceKey, envelopeJson, row.entitlement_revision, row.state_revision, input.claimToken ?? null),
  ]
  if (input.claimToken !== undefined) {
    statements.push(environment.CONTROL_DB.prepare(
      "UPDATE entitlement_renewal_claims SET state = 'issued', entitlement_version_id = ?, retry_at = NULL, last_error_code = NULL, updated_at = ? WHERE deployment_id = ? AND issuance_key = ? AND claim_token = ? AND state = 'claimed'",
    ).bind(id, now.toISOString(), input.deploymentId, issuanceKey, input.claimToken))
  }
  statements.push(
    environment.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET latest_version = CASE WHEN latest_version IS NULL OR latest_version < ? THEN ? ELSE latest_version END, next_check_at = ?, updated_at = ? WHERE deployment_id = ? AND contract_id = ?",
    ).bind(revision, revision, nextCheck(row, payload, now), now.toISOString(), input.deploymentId, row.contract_id),
    audit.statement,
  )
  try {
    await environment.CONTROL_DB.batch(statements)
  } catch (error) {
    const raced = await environment.CONTROL_DB.prepare(
      "SELECT id, deployment_id, contract_id, version, key_id, payload_json, signature, envelope_json, issuance_key, issued_at FROM entitlement_versions WHERE deployment_id = ? AND issuance_key = ?",
    ).bind(input.deploymentId, issuanceKey).first<StoredEntitlementRow>()
    if (raced) return fromStored(raced)
    if (error instanceof Error && error.message.includes("entitlement state changed")) {
      throw new SafeHttpError(409, "entitlement_state_changed")
    }
    throw error
  }
  const stored = await environment.CONTROL_DB.prepare(
    "SELECT id, deployment_id, contract_id, version, key_id, payload_json, signature, envelope_json, issuance_key, issued_at FROM entitlement_versions WHERE id = ?",
  ).bind(id).first<StoredEntitlementRow>()
  if (!stored) throw new Error("Entitlement issuance did not commit")
  return fromStored(stored)
}

function comparableLease(payload: EntitlementLease) {
  const {
    revision: _revision,
    leaseId: _leaseId,
    issuedAt: _issuedAt,
    leaseExpiresAt: _leaseExpiresAt,
    graceUntil: _graceUntil,
    ...desired
  } = payload
  return desired
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

async function claimRenewal(
  database: D1Database,
  deploymentId: string,
  issuanceKey: string,
  targetKeyId: string,
  now: Date,
): Promise<string | null> {
  const token = crypto.randomUUID()
  const at = now.toISOString()
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString()
  await database.prepare(
    "INSERT OR IGNORE INTO entitlement_renewal_claims (deployment_id, issuance_key, claim_token, target_key_id, state, claim_expires_at, attempt_count, retry_at, last_error_code, entitlement_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'claimed', ?, 1, NULL, NULL, NULL, ?, ?)",
  ).bind(deploymentId, issuanceKey, token, targetKeyId, expiresAt, at, at).run()
  await database.prepare(
    "UPDATE entitlement_renewal_claims SET claim_token = ?, target_key_id = ?, state = 'claimed', claim_expires_at = ?, attempt_count = attempt_count + 1, retry_at = NULL, updated_at = ? WHERE deployment_id = ? AND issuance_key = ? AND ((state = 'claimed' AND claim_expires_at <= ?) OR (state = 'failed' AND retry_at <= ?))",
  ).bind(token, targetKeyId, expiresAt, at, deploymentId, issuanceKey, at, at).run()
  const claim = await database.prepare(
    "SELECT claim_token, state FROM entitlement_renewal_claims WHERE deployment_id = ? AND issuance_key = ?",
  ).bind(deploymentId, issuanceKey).first<{ claim_token: string; state: string }>()
  return claim?.state === "claimed" && claim.claim_token === token ? token : null
}

async function updateScheduleFromSnapshot(
  database: D1Database,
  snapshot: EntitlementStateRow,
  nextCheckAt: string,
  updatedAt: string,
): Promise<boolean> {
  const result = await database.prepare(
    "UPDATE deployment_entitlement_schedules SET next_check_at = ?, updated_at = ? WHERE deployment_id = ? AND contract_id = ? AND state_revision = ? AND latest_version IS ? AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = ? AND c.entitlement_revision = ?) AND EXISTS (SELECT 1 FROM deployments d WHERE d.id = ? AND d.status = ? AND d.registered_at IS ?)",
  ).bind(
    nextCheckAt,
    updatedAt,
    snapshot.deployment_id,
    snapshot.contract_id,
    snapshot.state_revision,
    snapshot.latest_version,
    snapshot.contract_id,
    snapshot.entitlement_revision,
    snapshot.deployment_id,
    snapshot.deployment_status,
    snapshot.registered_at,
  ).run()
  return (result.meta.changes ?? 0) > 0
}

function retryAtOrCommercialBoundary(row: EntitlementStateRow, retryAt: string, now: Date): string {
  try {
    const candidates = [assertInstant(retryAt)]
    const { endsAt } = contractBounds(row)
    candidates.push(endsAt)
    for (const value of [row.suspension_at, row.seat_limit_effective_at]) {
      if (value !== null) candidates.push(assertInstant(value))
    }
    return new Date(Math.min(...candidates.filter((candidate) => candidate > now.getTime()))).toISOString()
  } catch {
    return retryAt
  }
}

export async function runEntitlementRenewal(environment: CloudflareBindings, clock = new Date()): Promise<{
  checked: number
  issued: number
  skipped: number
  failed: number
}> {
  const now = new Date(clock.getTime())
  const activeKeyId = boundedValue(environment.ENTITLEMENT_SIGNING_KEY_ID, 128)
  const summary = { checked: 0, issued: 0, skipped: 0, failed: 0 }
  let cursor = ""
  let workCount = 0
  while (workCount < RENEWAL_BATCH_SIZE && summary.checked < MAX_RENEWAL_SCANS) {
    const due = await environment.CONTROL_DB.prepare(
      "SELECT s.deployment_id, s.contract_id FROM deployment_entitlement_schedules s LEFT JOIN entitlement_versions e ON e.id = (SELECT current.id FROM entitlement_versions current WHERE current.deployment_id = s.deployment_id ORDER BY current.version DESC LIMIT 1) WHERE s.deployment_id > ? AND (s.next_check_at <= ? OR (e.id IS NOT NULL AND (e.key_id <> ? OR COALESCE(json_extract(e.payload_json, '$.schemaVersion'), 0) <> 2) AND NOT EXISTS (SELECT 1 FROM entitlement_renewal_claims r WHERE r.deployment_id = s.deployment_id AND r.target_key_id = ? AND r.issuance_key LIKE ('auto:' || e.version || ':%') AND ((r.state = 'claimed' AND r.claim_expires_at > ?) OR (r.state = 'failed' AND r.retry_at > ?))))) ORDER BY s.deployment_id LIMIT ?",
    ).bind(cursor, now.toISOString(), activeKeyId, activeKeyId, now.toISOString(), now.toISOString(), RENEWAL_BATCH_SIZE)
      .all<{ deployment_id: string; contract_id: string }>()
    if (due.results.length === 0) break
    cursor = due.results.at(-1)!.deployment_id
    for (const schedule of due.results) {
      if (workCount >= RENEWAL_BATCH_SIZE || summary.checked >= MAX_RENEWAL_SCANS) break
      summary.checked += 1
    let activeIssuanceKey: string | null = null
    let activeClaimToken: string | null = null
    let activeSnapshot: EntitlementStateRow | null = null
    try {
      const row = await loadState(environment.CONTROL_DB, schedule.deployment_id, schedule.contract_id)
      activeSnapshot = row
      const desired = await desiredLease(environment.CONTROL_DB, row, activeKeyId, (row.latest_version ?? 0) + 1, now)
      const latestRow = await environment.CONTROL_DB.prepare(
        "SELECT id, deployment_id, contract_id, version, key_id, payload_json, signature, envelope_json, issuance_key, issued_at FROM entitlement_versions WHERE deployment_id = ? ORDER BY version DESC LIMIT 1",
      ).bind(schedule.deployment_id).first<StoredEntitlementRow>()
      const latest = latestRow ? fromStored(latestRow) : null
      const latestCurrentLease = latest?.envelope.payload.schemaVersion === 2 ? latest.envelope.payload : null
      const materialChange = latestCurrentLease === null ||
        canonicalJson(comparableLease(latestCurrentLease)) !== canonicalJson(comparableLease(desired))
      const withinHorizon = latest === null || Date.parse(latest.envelope.payload.leaseExpiresAt) <= now.getTime() + RENEWAL_HORIZON_MS
      if (latestCurrentLease !== null && !materialChange && !withinHorizon) {
        await updateScheduleFromSnapshot(environment.CONTROL_DB, row, nextCheck(row, latestCurrentLease, now), now.toISOString())
        summary.skipped += 1
        workCount += 1
        continue
      }
      const desiredHash = await sha256Base64Url(canonicalJson(comparableLease(desired)))
      const issuanceKey = `auto:${latest?.version ?? 0}:${desiredHash}`
      activeIssuanceKey = issuanceKey
      const claimToken = await claimRenewal(environment.CONTROL_DB, schedule.deployment_id, issuanceKey, activeKeyId, now)
      if (claimToken === null) {
        const claim = await environment.CONTROL_DB.prepare(
          "SELECT state, claim_expires_at, retry_at FROM entitlement_renewal_claims WHERE deployment_id = ? AND issuance_key = ?",
        ).bind(schedule.deployment_id, issuanceKey).first<{
          state: "claimed" | "issued" | "failed"
          claim_expires_at: string
          retry_at: string | null
        }>()
        const blockedUntil = claim?.state === "claimed" ? claim.claim_expires_at
          : claim?.state === "failed" ? claim.retry_at : null
        if (blockedUntil !== null && Date.parse(blockedUntil) > now.getTime()) {
          await updateScheduleFromSnapshot(
            environment.CONTROL_DB,
            row,
            retryAtOrCommercialBoundary(row, blockedUntil, now),
            now.toISOString(),
          )
        } else {
          workCount += 1
        }
        summary.skipped += 1
        continue
      }
      activeClaimToken = claimToken
      await issueEntitlement(environment, {
        deploymentId: schedule.deployment_id,
        contractId: schedule.contract_id,
        issuanceKey,
        claimToken,
        actor: { operatorId: null, requestId: `scheduled:${schedule.deployment_id}:${now.toISOString()}`, source: "scheduled" },
        now,
      })
      summary.issued += 1
      workCount += 1
    } catch (error) {
      if (error instanceof DeploymentUnavailableError) {
        summary.skipped += 1
        workCount += 1
        await updateScheduleFromSnapshot(
          environment.CONTROL_DB,
          error.snapshot,
          new Date(now.getTime() + DAY_MS).toISOString(),
          now.toISOString(),
        ).catch(() => false)
        continue
      }
      if (error instanceof SafeHttpError && error.code === "entitlement_state_changed") {
        summary.failed += 1
        workCount += 1
        if (activeIssuanceKey !== null && activeClaimToken !== null) {
          await environment.CONTROL_DB.prepare(
            "UPDATE entitlement_renewal_claims SET state = 'failed', retry_at = ?, last_error_code = 'entitlement_state_changed', updated_at = ? WHERE deployment_id = ? AND issuance_key = ? AND state = 'claimed' AND claim_token = ?",
          ).bind(now.toISOString(), now.toISOString(), schedule.deployment_id, activeIssuanceKey, activeClaimToken).run().catch(() => undefined)
        }
        continue
      }
      summary.failed += 1
      workCount += 1
      const signingConfigurationInvalid = error instanceof Error &&
        error.message === "Entitlement signing configuration is unavailable"
      const deterministic = signingConfigurationInvalid || error instanceof SafeHttpError
      let delay = DAY_MS
      if (!deterministic && activeIssuanceKey !== null && activeClaimToken !== null) {
        const claim = await environment.CONTROL_DB.prepare(
          "SELECT attempt_count FROM entitlement_renewal_claims WHERE deployment_id = ? AND issuance_key = ? AND claim_token = ?",
        ).bind(schedule.deployment_id, activeIssuanceKey, activeClaimToken).first<{ attempt_count: number }>()
        delay = Math.min(120, 15 * 2 ** Math.max(0, (claim?.attempt_count ?? 1) - 1)) * 60 * 1_000
      }
      const retryAt = new Date(now.getTime() + delay).toISOString()
      let failureStillOwned = true
      if (activeIssuanceKey !== null && activeClaimToken !== null) {
        const result = await environment.CONTROL_DB.prepare(
          "UPDATE entitlement_renewal_claims SET state = 'failed', retry_at = ?, last_error_code = ?, updated_at = ? WHERE deployment_id = ? AND issuance_key = ? AND state = 'claimed' AND claim_token = ?",
        ).bind(
          retryAt,
          signingConfigurationInvalid ? "signing_configuration_invalid" : deterministic ? "invalid_entitlement_state" : "transient_failure",
          now.toISOString(),
          schedule.deployment_id,
          activeIssuanceKey,
          activeClaimToken,
        ).run().catch(() => null)
        failureStillOwned = (result?.meta.changes ?? 0) > 0
      }
      if (failureStillOwned && activeSnapshot !== null) {
        await updateScheduleFromSnapshot(
          environment.CONTROL_DB,
          activeSnapshot,
          retryAtOrCommercialBoundary(activeSnapshot, retryAt, now),
          now.toISOString(),
        ).catch(() => false)
      }
    }
  }
  }
  return summary
}
