import type { DeploymentHeartbeat, DeploymentRegistration } from "@crm/control-protocol/heartbeat"

import { prepareOperatorAuditStatement } from "../audit"
import {
  fromBase64Url,
  importStrictEd25519PublicJwk,
  installTokenDigest,
  publicKeyFingerprint,
  timingSafeDigestEqual,
  toBase64Url,
} from "../auth/deployment"
import { badRequest, unauthorized } from "../http/errors"

interface InstallTokenRow {
  id: string
  deployment_id: string
  token_digest: string
  expires_at: string
  used_at: string | null
  registration_key_fingerprint: string | null
  environment: string
  deployment_status: string
  registered_at: string | null
  deployment_registration_key_fingerprint: string | null
}

export interface DeploymentKeyRow {
  id: string
  deployment_id: string
  key_id: string
  algorithm: string
  public_jwk_json: string
  fingerprint: string
  not_before: string
  expires_at: string | null
  revoked_at: string | null
  replaced_by_key_id: string | null
  deployment_status: string
  environment: string
}

function assertServerSecret(value: string): void {
  if (value.length < 16 || value.length > 4_096) {
    throw new Error("Install token pepper is unavailable")
  }
}

function safeRequestId(value: string | null): string {
  return value && /^[\x21-\x7e]{1,256}$/.test(value) ? value : crypto.randomUUID()
}

export async function issueInstallToken(
  database: D1Database,
  deploymentId: string,
  pepper: string,
  expiresAt: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  assertServerSecret(pepper)
  if (!Number.isFinite(Date.parse(expiresAt))) throw new TypeError("Token expiry is invalid")
  const rawBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = toBase64Url(rawBytes)
  const digest = toBase64Url(await installTokenDigest(token, pepper))
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await database.prepare(
    "INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, registration_key_fingerprint, created_at) SELECT ?, id, ?, ?, NULL, NULL, ? FROM deployments WHERE id = ?",
  ).bind(id, digest, expiresAt, createdAt, deploymentId).run()

  const inserted = await database.prepare(
    "SELECT id FROM install_tokens WHERE id = ?",
  ).bind(id).first<{ id: string }>()
  if (!inserted) throw new TypeError("Deployment is invalid")
  return { id, token, expiresAt }
}

async function tokenRow(database: D1Database, digest: string): Promise<InstallTokenRow | null> {
  return database.prepare(
    "SELECT t.id, t.deployment_id, t.token_digest, t.expires_at, t.used_at, t.registration_key_fingerprint, d.environment, d.status AS deployment_status, d.registered_at, d.registration_key_fingerprint AS deployment_registration_key_fingerprint FROM install_tokens t JOIN deployments d ON d.id = t.deployment_id WHERE t.token_digest = ?",
  ).bind(digest).first<InstallTokenRow>()
}

function digestStringMatches(left: string, right: string): boolean {
  try {
    return timingSafeDigestEqual(fromBase64Url(left, 32), fromBase64Url(right, 32))
  } catch {
    return false
  }
}

async function recoverRegisteredKey(
  database: D1Database,
  input: {
    row: InstallTokenRow
    registration: DeploymentRegistration
    fingerprint: string
    requestCorrelationId: string | null
    now: string
  },
): Promise<{ deploymentId: string; keyId: string } | null> {
  if (
    input.row.deployment_id !== input.registration.deploymentId ||
    input.row.environment !== input.registration.environment ||
    input.row.deployment_status !== "active" ||
    !Number.isFinite(Date.parse(input.row.expires_at)) ||
    input.row.expires_at < input.now ||
    input.row.used_at === null ||
    input.row.registered_at === null ||
    input.row.registration_key_fingerprint === null ||
    input.row.deployment_registration_key_fingerprint === null ||
    !digestStringMatches(input.row.registration_key_fingerprint, input.fingerprint) ||
    !digestStringMatches(input.row.deployment_registration_key_fingerprint, input.fingerprint)
  ) {
    return null
  }
  const key = await database.prepare(
    "SELECT key_id, fingerprint FROM deployment_keys WHERE deployment_id = ? AND registration_token_id = ?",
  ).bind(input.registration.deploymentId, input.row.id).first<{ key_id: string; fingerprint: string }>()
  if (!key || !digestStringMatches(key.fingerprint, input.fingerprint)) return null

  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: null,
    action: "deployment.register.retry",
    targetType: "deployment",
    targetId: input.registration.deploymentId,
    outcome: "success",
    requestId: safeRequestId(input.requestCorrelationId),
    metadata: {
      claimId: input.row.id,
      fingerprint: input.fingerprint,
      keyId: key.key_id,
      agentVersion: input.registration.agentVersion,
    },
    createdAt: input.now,
  })
  await database.batch([audit.statement])
  return { deploymentId: input.registration.deploymentId, keyId: key.key_id }
}

export async function registerDeployment(
  database: D1Database,
  registration: DeploymentRegistration,
  pepper: string,
  requestCorrelationId: string | null,
): Promise<{ deploymentId: string; keyId: string }> {
  assertServerSecret(pepper)
  let publicKey: CryptoKey
  try {
    publicKey = await importStrictEd25519PublicJwk(registration.publicKey)
  } catch {
    throw badRequest()
  }
  if (publicKey.type !== "public") throw badRequest()

  const computedDigestBytes = await installTokenDigest(registration.installationToken, pepper)
  const digest = toBase64Url(computedDigestBytes)
  const row = await tokenRow(database, digest)
  const storedDigestBytes = row
    ? fromBase64Url(row.token_digest, 32)
    : new Uint8Array(32)
  const digestMatches = timingSafeDigestEqual(computedDigestBytes, storedDigestBytes)
  const now = new Date().toISOString()
  const fingerprint = await publicKeyFingerprint(registration.publicKey.x)
  if (
    !row ||
    !digestMatches ||
    row.deployment_id !== registration.deploymentId ||
    row.environment !== registration.environment ||
    row.deployment_status !== "active" ||
    !Number.isFinite(Date.parse(row.expires_at)) ||
    row.expires_at < now
  ) {
    throw unauthorized()
  }

  if (
    row.registered_at !== null ||
    row.used_at !== null ||
    row.registration_key_fingerprint !== null ||
    row.deployment_registration_key_fingerprint !== null
  ) {
    const recovered = await recoverRegisteredKey(database, {
      row,
      registration,
      fingerprint,
      requestCorrelationId,
      now,
    })
    if (recovered) return recovered
    throw unauthorized()
  }

  const keyRecordId = crypto.randomUUID()
  const keyId = crypto.randomUUID()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: null,
    action: "deployment.register",
    targetType: "deployment",
    targetId: registration.deploymentId,
    outcome: "success",
    requestId: safeRequestId(requestCorrelationId),
    metadata: {
      claimId: row.id,
      fingerprint,
      keyId,
      agentVersion: registration.agentVersion,
    },
    createdAt: now,
  })

  try {
    await database.batch([
      database.prepare(
        "UPDATE install_tokens SET used_at = ?, registration_key_fingerprint = ? WHERE id = ? AND deployment_id = ? AND token_digest = ? AND used_at IS NULL AND registration_key_fingerprint IS NULL AND expires_at >= ?",
      ).bind(now, fingerprint, row.id, registration.deploymentId, digest, now),
      database.prepare(
        "INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', ?, ?, ?, NULL, NULL, NULL, ?, ?)",
      ).bind(
        keyRecordId,
        registration.deploymentId,
        keyId,
        JSON.stringify({ kty: "OKP", crv: "Ed25519", x: registration.publicKey.x }),
        fingerprint,
        now,
        row.id,
        now,
      ),
      audit.statement,
    ])
  } catch (error) {
    const current = await tokenRow(database, digest)
    if (current) {
      const recovered = await recoverRegisteredKey(database, {
        row: current,
        registration,
        fingerprint,
        requestCorrelationId,
        now: new Date().toISOString(),
      })
      if (recovered) return recovered
    }
    throw error
  }

  return { deploymentId: registration.deploymentId, keyId }
}

export async function getActiveDeploymentKey(
  database: D1Database,
  deploymentId: string,
  keyId: string,
  now: string,
): Promise<DeploymentKeyRow | null> {
  const row = await database.prepare(
    "SELECT k.id, k.deployment_id, k.key_id, k.algorithm, k.public_jwk_json, k.fingerprint, k.not_before, k.expires_at, k.revoked_at, k.replaced_by_key_id, d.status AS deployment_status, d.environment FROM deployment_keys k JOIN deployments d ON d.id = k.deployment_id WHERE k.key_id = ? AND k.deployment_id = ?",
  ).bind(keyId, deploymentId).first<DeploymentKeyRow>()
  const nowTime = Date.parse(now)
  const notBeforeTime = row ? Date.parse(row.not_before) : Number.NaN
  const expiresTime = row?.expires_at === null ? null : Date.parse(row?.expires_at ?? "")
  if (
    !row ||
    row.algorithm !== "Ed25519" ||
    row.deployment_status !== "active" ||
    row.revoked_at !== null ||
    row.replaced_by_key_id !== null ||
    !Number.isFinite(nowTime) ||
    !Number.isFinite(notBeforeTime) ||
    notBeforeTime > nowTime ||
    (expiresTime !== null && (!Number.isFinite(expiresTime) || expiresTime <= nowTime))
  ) {
    return null
  }
  return row
}

export async function recordHeartbeat(
  database: D1Database,
  input: {
    key: DeploymentKeyRow
    heartbeat: DeploymentHeartbeat
    timestamp: string
    nonceDigest: string
    nonceExpiresAt: string
    observedAt: string
    requestCorrelationId: string | null
    payloadBytes: number
  },
): Promise<void> {
  await database.prepare(
    "DELETE FROM deployment_request_nonces WHERE expires_at < ?",
  ).bind(input.observedAt).run().catch(() => undefined)

  const rollupId = crypto.randomUUID()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: null,
    action: "deployment.heartbeat",
    targetType: "deployment",
    targetId: input.heartbeat.deploymentId,
    outcome: "success",
    requestId: safeRequestId(input.requestCorrelationId),
    metadata: {
      keyId: input.key.key_id,
      fingerprint: input.key.fingerprint,
      payloadBytes: input.payloadBytes,
      activeUserCount: input.heartbeat.activeUserCount,
      reservedInvitationCount: input.heartbeat.reservedInvitationCount,
      healthState: input.heartbeat.healthState,
    },
    createdAt: input.observedAt,
  })
  try {
    await database.batch([
      database.prepare(
        "INSERT INTO deployment_request_nonces (deployment_key_id, nonce_digest, expires_at, created_at) VALUES (?, ?, ?, ?)",
      ).bind(input.key.id, input.nonceDigest, input.nonceExpiresAt, input.observedAt),
      database.prepare(
        "INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, client_timestamp, image_digest, entitlement_version, configuration_version, active_user_count, reserved_invitation_count, enabled_module_ids_json, migration_version, last_successful_backup_at, last_restore_test_at, agent_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        rollupId,
        input.heartbeat.deploymentId,
        input.observedAt,
        input.heartbeat.activeUserCount + input.heartbeat.reservedInvitationCount,
        input.heartbeat.applicationVersion,
        input.heartbeat.healthState,
        input.timestamp,
        input.heartbeat.imageDigest,
        input.heartbeat.entitlementVersion,
        input.heartbeat.configurationVersion,
        input.heartbeat.activeUserCount,
        input.heartbeat.reservedInvitationCount,
        JSON.stringify(input.heartbeat.enabledModuleIds),
        input.heartbeat.migrationVersion,
        input.heartbeat.lastSuccessfulBackupAt,
        input.heartbeat.lastRestoreTestAt,
        input.heartbeat.agentVersion,
        input.observedAt,
      ),
      audit.statement,
    ])
  } catch (error) {
    const replay = await database.prepare(
      "SELECT 1 AS present FROM deployment_request_nonces WHERE deployment_key_id = ? AND nonce_digest = ?",
    ).bind(input.key.id, input.nonceDigest).first<{ present: number }>()
    if (replay?.present === 1) throw unauthorized()
    throw error
  }
}
