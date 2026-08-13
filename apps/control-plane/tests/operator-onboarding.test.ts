import { applyD1Migrations, env, type D1Migration } from "cloudflare:test"
import { beforeAll, describe, expect, inject, it } from "vitest"

import { getClientDetail, parseClientChildPagination } from "../src/repos/clients"
import { getDeploymentWorkspace } from "../src/repos/onboarding"

const NOW = new Date("2026-08-10T12:00:00.000Z")
const HOUR_MS = 60 * 60 * 1_000
const REGISTRATION_FINGERPRINT = "f".repeat(43)

interface Fixture {
  clientId: string
  deploymentId: string
  contractId: string
}

async function fixture(): Promise<Fixture> {
  const clientId = crypto.randomUUID()
  const deploymentId = crypto.randomUUID()
  const contractId = crypto.randomUUID()
  const createdAt = NOW.toISOString()
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT OR IGNORE INTO plans (id, plan_key, display_name, active, created_at, updated_at) VALUES ('onboarding-plan', 'onboarding', 'Onboarding', 1, ?, ?)",
    ).bind(createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Client', 'active', ?, ?)",
    ).bind(clientId, `client-${clientId}`, createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployments (id, client_id, deployment_key, environment, status, created_at, updated_at) VALUES (?, ?, ?, 'production', 'active', ?, ?)",
    ).bind(deploymentId, clientId, `deployment-${deploymentId}`, createdAt, createdAt),
    env.CONTROL_DB.prepare(
      "INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'onboarding-plan', 'active', '2026-08-01', '2026-08-31', 25, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)",
    ).bind(contractId, clientId, createdAt, createdAt),
  ])
  return { clientId, deploymentId, contractId }
}

async function registerDeployment(deploymentId: string) {
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "UPDATE deployments SET registered_at = ?, registration_key_fingerprint = ? WHERE id = ?",
    ).bind(NOW.toISOString(), REGISTRATION_FINGERPRINT, deploymentId),
    env.CONTROL_DB.prepare(
      "INSERT INTO deployment_keys (id, deployment_id, key_id, algorithm, public_jwk_json, fingerprint, not_before, expires_at, revoked_at, replaced_by_key_id, registration_token_id, created_at) VALUES (?, ?, ?, 'Ed25519', '{}', ?, ?, NULL, NULL, NULL, NULL, ?)",
    ).bind(crypto.randomUUID(), deploymentId, crypto.randomUUID(), REGISTRATION_FINGERPRINT, NOW.toISOString(), NOW.toISOString()),
  ])
}

async function assignSchedule(input: Fixture) {
  await env.CONTROL_DB.prepare(
    "INSERT INTO deployment_entitlement_schedules (deployment_id, contract_id, next_check_at, latest_version, configuration_version, release_channel, minimum_supported_app_version, approved_image_digest, state_revision, updated_at) VALUES (?, ?, ?, NULL, 'configuration-1', 'stable', '1.0.0', NULL, 1, ?)",
  ).bind(input.deploymentId, input.contractId, NOW.toISOString(), NOW.toISOString()).run()
}

async function issueEntitlement(input: Fixture) {
  const payload = {
    schemaVersion: 2,
    revision: 1,
    keyId: "vendor-key",
    leaseId: "lease-1",
    clientId: input.clientId,
    deploymentId: input.deploymentId,
    issuedAt: "2026-08-09T12:00:00.000Z",
    leaseExpiresAt: "2026-08-10T12:00:00.000Z",
    contractStartsAt: "2026-08-01T00:00:00.000Z",
    contractEndsAt: "2026-09-01T00:00:00.000Z",
    graceUntil: "2026-08-17T12:00:00.000Z",
    subscriptionStatus: "active",
    planId: "onboarding-plan",
    maxActiveUsers: 25,
    moduleIds: [],
    addonIds: [],
    configurationVersion: "configuration-1",
    releaseChannel: "stable",
    minimumSupportedAppVersion: "1.0.0",
  }
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      "INSERT INTO entitlement_versions (id, deployment_id, contract_id, version, key_id, payload_json, signature, issued_at, created_at, issuance_key, envelope_json, contract_revision, schedule_revision, renewal_claim_token) VALUES (?, ?, ?, 1, 'vendor-key', ?, 'signature', ?, ?, 'manual:onboarding', NULL, 1, 1, NULL)",
    ).bind(crypto.randomUUID(), input.deploymentId, input.contractId, JSON.stringify(payload), payload.issuedAt, payload.issuedAt),
    env.CONTROL_DB.prepare(
      "UPDATE deployment_entitlement_schedules SET latest_version = 1 WHERE deployment_id = ?",
    ).bind(input.deploymentId),
  ])
}

async function heartbeat(deploymentId: string, observedAt: Date, health = "healthy") {
  await env.CONTROL_DB.prepare(
    "INSERT INTO heartbeat_rollups (id, deployment_id, observed_at, occupied_seats, application_version, health_status, created_at) VALUES (?, ?, ?, 1, '1.0.0', ?, ?)",
  ).bind(crypto.randomUUID(), deploymentId, observedAt.toISOString(), health, observedAt.toISOString()).run()
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL_DB, inject("migrations") as D1Migration[])
})

describe("operator onboarding workspace", () => {
  it("requires a compatible contract before installation", async () => {
    const input = await fixture()
    await env.CONTROL_DB.prepare("DELETE FROM contracts WHERE id = ?").bind(input.contractId).run()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: {
        progress: "contract",
        nextAction: "create_contract",
        licenceState: "unsigned",
        connectivityState: "never_connected",
      },
    })
  })

  it("requires deployment registration before scheduling", async () => {
    const input = await fixture()

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "install", nextAction: "issue_install_token" },
    })
  })

  it("requires a schedule after registration", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "configure", nextAction: "configure_entitlement" },
    })
  })

  it("requires signing after a schedule exists", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "sign", nextAction: "issue_entitlement", licenceState: "unsigned" },
    })
  })

  it.each([
    ["missing", undefined, "never_connected"],
    ["stale", new Date(NOW.getTime() - 30 * 60 * 1_000 - 1), "stale"],
    ["unhealthy", new Date(NOW.getTime() - HOUR_MS), "stale"],
  ] as const)("requires a healthy current heartbeat when it is %s", async (_label, observedAt, connectivityState) => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    if (observedAt) await heartbeat(input.deploymentId, observedAt, _label === "unhealthy" ? "unhealthy" : "healthy")

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      onboarding: { progress: "verify", nextAction: "verify_heartbeat", licenceState: "active", connectivityState },
    })
  })

  it("marks an unexpired lease active and the workspace complete", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1))

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, new Date("2026-08-10T11:59:59.999Z"))).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "none", licenceState: "active", connectivityState: "online" },
    })
  })

  it("keeps a grace lease distinct from connectivity and requests a new version", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    const graceNow = new Date("2026-08-11T12:00:00.001Z")
    await heartbeat(input.deploymentId, graceNow)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, graceNow)).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "issue_new_version", licenceState: "grace", connectivityState: "online" },
    })
  })

  it("marks an expired grace lease read-only without conflating it with connectivity", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    const readOnlyNow = new Date("2026-08-17T12:00:00.001Z")
    await heartbeat(input.deploymentId, readOnlyNow)

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, readOnlyNow)).resolves.toMatchObject({
      onboarding: { progress: "complete", nextAction: "issue_new_version", licenceState: "read_only", connectivityState: "online" },
    })
  })

  it("returns workspace records without crossing client boundaries", async () => {
    const input = await fixture()
    await registerDeployment(input.deploymentId)
    await assignSchedule(input)
    await issueEntitlement(input)
    await heartbeat(input.deploymentId, new Date(NOW.getTime() - 1))
    const otherClientId = crypto.randomUUID()
    const otherContractId = crypto.randomUUID()
    const createdAt = NOW.toISOString()
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare("INSERT INTO clients (id, client_key, display_name, status, created_at, updated_at) VALUES (?, ?, 'Other', 'active', ?, ?)")
        .bind(otherClientId, `client-${otherClientId}`, createdAt, createdAt),
      env.CONTROL_DB.prepare("INSERT INTO contracts (id, client_id, plan_id, status, starts_at, ends_at, seat_limit, monthly_seat_price_cents, tax_basis_points, collection_frequency, total_cents, renewal_policy, created_at, updated_at) VALUES (?, ?, 'onboarding-plan', 'active', '2026-08-01', '2026-08-31', 25, 0, 0, 'upfront', 0, 'auto_renew', ?, ?)")
        .bind(otherContractId, otherClientId, createdAt, createdAt),
      env.CONTROL_DB.prepare("INSERT INTO install_tokens (id, deployment_id, token_digest, expires_at, used_at, registration_key_fingerprint, created_at) VALUES (?, ?, 'digest', ?, NULL, NULL, ?)")
        .bind(crypto.randomUUID(), input.deploymentId, "2026-08-11T12:00:00.000Z", createdAt),
      env.CONTROL_DB.prepare("INSERT INTO operator_audit_log (id, operator_id, action, target_type, target_id, outcome, request_id_hash, metadata_json, created_at) VALUES (?, NULL, 'deployment.heartbeat', 'deployment', ?, 'success', 'request', '{}', ?)")
        .bind(crypto.randomUUID(), input.deploymentId, createdAt),
    ])

    await expect(getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)).resolves.toMatchObject({
      client: { id: input.clientId },
      compatibleContracts: [{ id: input.contractId }],
      registration: { registeredAt: NOW.toISOString(), keyFingerprint: REGISTRATION_FINGERPRINT },
      token: { expiresAt: "2026-08-11T12:00:00.000Z", usedAt: null },
      schedule: { contractId: input.contractId, latestVersion: 1 },
      latestEntitlement: { version: 1 },
      latestHeartbeat: { healthStatus: "healthy" },
      recentEntitlements: [{ version: 1 }],
      recentAuditEvents: [{ action: "deployment.heartbeat" }],
    })
    const workspace = await getDeploymentWorkspace(env.CONTROL_DB, input.deploymentId, NOW)
    expect(workspace.compatibleContracts.map((contract) => contract.id)).toEqual([input.contractId])
  })

  it("exposes client deployment links to the signing workspace", async () => {
    const input = await fixture()
    const client = await getClientDetail(
      env.CONTROL_DB,
      input.clientId,
      parseClientChildPagination("https://control.invalid/operator/clients/test"),
    )

    expect(client.deployments.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: input.deploymentId, href: `/operator/deployments/${input.deploymentId}` }),
    ]))
  })
})
