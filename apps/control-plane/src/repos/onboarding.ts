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
    planId: string
    status: string
    startsAt: string
    endsAt: string
    seatLimit: number
    entitlementRevision: number
    modules: Array<{ id: string; displayName: string }>
  }>
  registration: { registeredAt: string; keyFingerprint: string; keyId: string } | null
  token: {
    id: string
    expiresAt: string
    usedAt: string | null
    supersededAt: string | null
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
    entitlementVersion: string | null
    configurationVersion: string | null
  } | null
  recentEntitlements: EntitlementSummary[]
  entitlementHistoryCapped: boolean
  recentAuditEvents: Array<{
    id: string
    action: string
    outcome: "success" | "denied" | "error"
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
  entitlementIsCurrent: boolean
  heartbeatAcknowledgesCurrentState: boolean
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
  if (!input.entitlementIsCurrent) {
    return { progress: "sign", nextAction: "issue_new_version", licenceState, connectivityState }
  }
  if (licenceState === "grace" || licenceState === "read_only") {
    return { progress: "complete", nextAction: "issue_new_version", licenceState, connectivityState }
  }
  if (connectivityState !== "online" || !input.heartbeatAcknowledgesCurrentState) {
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
  const [compatibleContracts, contractModules, registrationKey, token, schedule, entitlementRows, heartbeat, auditEvents] = await Promise.all([
    database.prepare(
      "SELECT id, plan_id, status, starts_at, ends_at, seat_limit, entitlement_revision FROM contracts WHERE client_id = ? AND status IN ('active', 'past_due') AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at DESC, id DESC",
    ).bind(deployment.client_id, today, today).all<{
      id: string
      plan_id: string
      status: string
      starts_at: string
      ends_at: string
      seat_limit: number
      entitlement_revision: number
    }>(),
    database.prepare(
      "SELECT cm.contract_id, cm.module_id, mc.display_name FROM contracts c JOIN contract_modules cm ON cm.contract_id = c.id JOIN module_catalog mc ON mc.module_id = cm.module_id WHERE c.client_id = ? AND c.status IN ('active', 'past_due') AND c.starts_at <= ? AND c.ends_at >= ? ORDER BY cm.contract_id, mc.display_name, cm.module_id",
    ).bind(deployment.client_id, today, today).all<{
      contract_id: string
      module_id: string
      display_name: string
    }>(),
    database.prepare(
      "SELECT key_id, fingerprint FROM deployment_keys WHERE deployment_id = ? AND algorithm = 'Ed25519' AND revoked_at IS NULL AND replaced_by_key_id IS NULL AND not_before <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId, now.toISOString(), now.toISOString()).first<{ key_id: string; fingerprint: string }>(),
    database.prepare(
      "SELECT id, expires_at, used_at, superseded_at, registration_key_fingerprint, created_at FROM install_tokens WHERE deployment_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{
      id: string
      expires_at: string
      used_at: string | null
      superseded_at: string | null
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
      "SELECT id, contract_id, version, key_id, payload_json, contract_revision, schedule_revision, issued_at FROM entitlement_versions WHERE deployment_id = ? ORDER BY version DESC LIMIT ?",
    ).bind(deploymentId, RECENT_LIMIT + 1).all<{
      id: string
      contract_id: string
      version: number
      key_id: string
      payload_json: string
      contract_revision: number | null
      schedule_revision: number | null
      issued_at: string
    }>(),
    database.prepare(
      "SELECT observed_at, health_status, application_version, occupied_seats, entitlement_version, configuration_version FROM heartbeat_rollups WHERE deployment_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
    ).bind(deploymentId).first<{
      observed_at: string
      health_status: string
      application_version: string
      occupied_seats: number
      entitlement_version: string | null
      configuration_version: string | null
    }>(),
    database.prepare(
      "SELECT id, action, outcome, created_at FROM operator_audit_log WHERE target_type = 'deployment' AND target_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    ).bind(deploymentId, RECENT_LIMIT).all<{
      id: string
      action: string
      outcome: "success" | "denied" | "error"
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
      contractRevision: row.contract_revision,
      scheduleRevision: row.schedule_revision,
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
    entitlementVersion: heartbeat.entitlement_version,
    configurationVersion: heartbeat.configuration_version,
  }
  const scheduledContract = schedule === null
    ? undefined
    : compatibleContracts.results.find((contract) => contract.id === schedule.contract_id)
  const entitlementIsCurrent = latest !== null && schedule !== null && scheduledContract !== undefined &&
    latest.summary.contractId === schedule.contract_id &&
    latest.contractRevision !== null && latest.contractRevision === scheduledContract.entitlement_revision &&
    latest.scheduleRevision !== null && latest.scheduleRevision === schedule.state_revision
  const heartbeatAcknowledgesCurrentState = latestHeartbeat !== null && latest !== null && schedule !== null &&
    latestHeartbeat.entitlementVersion === String(latest.summary.version) &&
    latestHeartbeat.configurationVersion === schedule.configuration_version

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
      planId: contract.plan_id,
      status: contract.status,
      startsAt: contract.starts_at,
      endsAt: contract.ends_at,
      seatLimit: contract.seat_limit,
      entitlementRevision: contract.entitlement_revision,
      modules: contractModules.results
        .filter((module) => module.contract_id === contract.id)
        .map((module) => ({ id: module.module_id, displayName: module.display_name })),
    })),
    registration,
    token: token === null ? null : {
      id: token.id,
      expiresAt: token.expires_at,
      usedAt: token.used_at,
      supersededAt: token.superseded_at,
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
    recentEntitlements: entitlements.slice(0, RECENT_LIMIT).map(({ summary }) => summary),
    entitlementHistoryCapped: entitlements.length > RECENT_LIMIT,
    recentAuditEvents: auditEvents.results.map((audit) => ({
      id: audit.id,
      action: audit.action,
      outcome: audit.outcome,
      createdAt: audit.created_at,
    })),
    onboarding: deriveOnboardingState({
      hasCompatibleContract: compatibleContracts.results.length > 0,
      isRegistered: registration !== null,
      hasSchedule: schedule !== null && compatibleContracts.results.some(
        (contract) => contract.id === schedule.contract_id,
      ),
      lease: latest?.lease ?? null,
      heartbeat: latestHeartbeat,
      entitlementIsCurrent,
      heartbeatAcknowledgesCurrentState,
      now,
    }),
  }
}
