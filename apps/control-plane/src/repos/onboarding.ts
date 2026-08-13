import {
  EntitlementLeaseSchema,
  LegacyEntitlementLeaseSchema,
  evaluateLease,
  type EntitlementLease,
  type LegacyEntitlementLease,
} from "@crm/control-protocol"

import { notFound } from "../http/errors"

const HEARTBEAT_FRESHNESS_MS = 30 * 60 * 1_000
const RECENT_LIMIT = 10

type StoredLease = EntitlementLease | LegacyEntitlementLease

export type LicenceState = "unsigned" | "active" | "grace" | "read_only"
export type ConnectivityState = "online" | "stale" | "never_connected"
export type OnboardingProgress = "contract" | "install" | "configure" | "sign" | "verify" | "complete"
export type OnboardingNextAction =
  | "create_contract"
  | "issue_install_token"
  | "configure_entitlement"
  | "issue_entitlement"
  | "verify_heartbeat"
  | "issue_new_version"
  | "none"

export interface OnboardingState {
  progress: OnboardingProgress
  nextAction: OnboardingNextAction
  licenceState: LicenceState
  connectivityState: ConnectivityState
}

interface EntitlementSummary {
  id: string
  contractId: string
  version: number
  keyId: string
  issuedAt: string
  leaseExpiresAt: string | null
  graceUntil: string | null
}

export interface DeploymentWorkspace {
  client: { id: string; clientKey: string; displayName: string; status: string }
  deployment: {
    id: string
    deploymentKey: string
    environment: string
    status: string
  }
  compatibleContracts: Array<{
    id: string
    status: string
    startsAt: string
    endsAt: string
    seatLimit: number
  }>
  registration: { registeredAt: string; keyFingerprint: string; keyId: string } | null
  token: {
    id: string
    expiresAt: string
    usedAt: string | null
    registrationKeyFingerprint: string | null
    createdAt: string
  } | null
  schedule: {
    contractId: string
    nextCheckAt: string
    latestVersion: number | null
    configurationVersion: string
    releaseChannel: "stable" | "beta" | "canary"
    minimumSupportedAppVersion: string
    approvedImageDigest: string | null
    stateRevision: number
    updatedAt: string
  } | null
  latestEntitlement: EntitlementSummary | null
  latestHeartbeat: {
    observedAt: string
    healthStatus: string
    applicationVersion: string
    occupiedSeats: number
  } | null
  recentEntitlements: EntitlementSummary[]
  recentAuditEvents: Array<{
    id: string
    action: string
    outcome: "success" | "denied" | "error"
    metadataJson: string
    createdAt: string
  }>
  onboarding: OnboardingState
}

function parseLease(payloadJson: string): StoredLease | null {
  let payload: unknown
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    return null
  }
  const current = EntitlementLeaseSchema.safeParse(payload)
  if (current.success) return current.data
  const legacy = LegacyEntitlementLeaseSchema.safeParse(payload)
  return legacy.success ? legacy.data : null
}

export function deriveOnboardingState(input: {
  hasCompatibleContract: boolean
  isRegistered: boolean
  hasSchedule: boolean
  lease: StoredLease | null
  heartbeat: { observedAt: string; healthStatus: string } | null
  now: Date
}): OnboardingState {
  const licenceState: LicenceState = input.lease === null
    ? "unsigned"
    : evaluateLease(input.lease, input.now).mode
  const observedAt = input.heartbeat === null ? Number.NaN : Date.parse(input.heartbeat.observedAt)
  const connectivityState: ConnectivityState = input.heartbeat === null
    ? "never_connected"
    : input.heartbeat.healthStatus === "healthy" && Number.isFinite(observedAt) &&
        observedAt <= input.now.getTime() && input.now.getTime() - observedAt <= HEARTBEAT_FRESHNESS_MS
      ? "online"
      : "stale"

  if (!input.hasCompatibleContract) {
    return { progress: "contract", nextAction: "create_contract", licenceState, connectivityState }
  }
  if (!input.isRegistered) {
    return { progress: "install", nextAction: "issue_install_token", licenceState, connectivityState }
  }
  if (!input.hasSchedule) {
    return { progress: "configure", nextAction: "configure_entitlement", licenceState, connectivityState }
  }
  if (input.lease === null) {
    return { progress: "sign", nextAction: "issue_entitlement", licenceState, connectivityState }
  }
  if (licenceState === "grace" || licenceState === "read_only") {
    return { progress: "complete", nextAction: "issue_new_version", licenceState, connectivityState }
  }
  if (connectivityState !== "online") {
    return { progress: "verify", nextAction: "verify_heartbeat", licenceState, connectivityState }
  }
  return { progress: "complete", nextAction: "none", licenceState, connectivityState }
}

export async function getDeploymentWorkspace(
  database: D1Database,
  deploymentId: string,
  now: Date,
): Promise<DeploymentWorkspace> {
  const deployment = await database.prepare(
    "SELECT d.id, d.deployment_key, d.environment, d.status, d.registered_at, d.registration_key_fingerprint, c.id AS client_id, c.client_key, c.display_name, c.status AS client_status FROM deployments d JOIN clients c ON c.id = d.client_id WHERE d.id = ?",
  ).bind(deploymentId).first<{
    id: string
    deployment_key: string
    environment: string
    status: string
    registered_at: string | null
    registration_key_fingerprint: string | null
    client_id: string
    client_key: string
    display_name: string
    client_status: string
  }>()
  if (!deployment) throw notFound()

  const today = now.toISOString().slice(0, 10)
  const [compatibleContracts, registrationKey, token, schedule, entitlementRows, heartbeat, auditEvents] = await Promise.all([
    database.prepare(
      "SELECT id, status, starts_at, ends_at, seat_limit FROM contracts WHERE client_id = ? AND status IN ('active', 'past_due') AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at DESC, id DESC",
    ).bind(deployment.client_id, today, today).all<{
      id: string
      status: string
      starts_at: string
      ends_at: string
      seat_limit: number
    }>(),
    database.prepare(
      "SELECT key_id, fingerprint FROM deployment_keys WHERE deployment_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{ key_id: string; fingerprint: string }>(),
    database.prepare(
      "SELECT id, expires_at, used_at, registration_key_fingerprint, created_at FROM install_tokens WHERE deployment_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{
      id: string
      expires_at: string
      used_at: string | null
      registration_key_fingerprint: string | null
      created_at: string
    }>(),
    database.prepare(
      "SELECT contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at FROM deployment_entitlement_schedules WHERE deployment_id = ?",
    ).bind(deploymentId).first<{
      contract_id: string
      next_check_at: string
      latest_version: number | null
      configuration_version: string
      release_channel: "stable" | "beta" | "canary"
      minimum_supported_app_version: string
      approved_image_digest: string | null
      state_revision: number
      updated_at: string
    }>(),
    database.prepare(
      "SELECT id, contract_id, version, key_id, payload_json, issued_at FROM entitlement_versions WHERE deployment_id = ? ORDER BY version DESC LIMIT ?",
    ).bind(deploymentId, RECENT_LIMIT).all<{
      id: string
      contract_id: string
      version: number
      key_id: string
      payload_json: string
      issued_at: string
    }>(),
    database.prepare(
      "SELECT observed_at, health_status, application_version, occupied_seats FROM heartbeat_rollups WHERE deployment_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{
      observed_at: string
      health_status: string
      application_version: string
      occupied_seats: number
    }>(),
    database.prepare(
      "SELECT id, action, outcome, metadata_json, created_at FROM operator_audit_log WHERE target_type = 'deployment' AND target_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    ).bind(deploymentId, RECENT_LIMIT).all<{
      id: string
      action: string
      outcome: "success" | "denied" | "error"
      metadata_json: string
      created_at: string
    }>(),
  ])

  const entitlements = entitlementRows.results.map((row) => {
    const lease = parseLease(row.payload_json)
    return {
      summary: {
        id: row.id,
        contractId: row.contract_id,
        version: row.version,
        keyId: row.key_id,
        issuedAt: row.issued_at,
        leaseExpiresAt: lease?.leaseExpiresAt ?? null,
        graceUntil: lease?.graceUntil ?? null,
      },
      lease,
    }
  })
  const latest = entitlements[0] ?? null
  const registration = deployment.registered_at !== null && deployment.registration_key_fingerprint !== null && registrationKey !== null
    ? {
      registeredAt: deployment.registered_at,
      keyFingerprint: deployment.registration_key_fingerprint,
      keyId: registrationKey.key_id,
    }
    : null
  const latestHeartbeat = heartbeat === null ? null : {
    observedAt: heartbeat.observed_at,
    healthStatus: heartbeat.health_status,
    applicationVersion: heartbeat.application_version,
    occupiedSeats: heartbeat.occupied_seats,
  }

  return {
    client: {
      id: deployment.client_id,
      clientKey: deployment.client_key,
      displayName: deployment.display_name,
      status: deployment.client_status,
    },
    deployment: {
      id: deployment.id,
      deploymentKey: deployment.deployment_key,
      environment: deployment.environment,
      status: deployment.status,
    },
    compatibleContracts: compatibleContracts.results.map((contract) => ({
      id: contract.id,
      status: contract.status,
      startsAt: contract.starts_at,
      endsAt: contract.ends_at,
      seatLimit: contract.seat_limit,
    })),
    registration,
    token: token === null ? null : {
      id: token.id,
      expiresAt: token.expires_at,
      usedAt: token.used_at,
      registrationKeyFingerprint: token.registration_key_fingerprint,
      createdAt: token.created_at,
    },
    schedule: schedule === null ? null : {
      contractId: schedule.contract_id,
      nextCheckAt: schedule.next_check_at,
      latestVersion: schedule.latest_version,
      configurationVersion: schedule.configuration_version,
      releaseChannel: schedule.release_channel,
      minimumSupportedAppVersion: schedule.minimum_supported_app_version,
      approvedImageDigest: schedule.approved_image_digest,
      stateRevision: schedule.state_revision,
      updatedAt: schedule.updated_at,
    },
    latestEntitlement: latest?.summary ?? null,
    latestHeartbeat,
    recentEntitlements: entitlements.map(({ summary }) => summary),
    recentAuditEvents: auditEvents.results.map((audit) => ({
      id: audit.id,
      action: audit.action,
      outcome: audit.outcome,
      metadataJson: audit.metadata_json,
      createdAt: audit.created_at,
    })),
    onboarding: deriveOnboardingState({
      hasCompatibleContract: compatibleContracts.results.length > 0,
      isRegistered: registration !== null,
      hasSchedule: schedule !== null,
      lease: latest?.lease ?? null,
      heartbeat: latestHeartbeat,
      now,
    }),
  }
}
