import { signEnvelope, type EntitlementLease } from "@crm/control-protocol"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import {
  createDeploymentControlService,
  createPostgresDeploymentControlPersistence,
} from "@/lib/deployment-control"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const integration = adminUrl && appUrl ? describe : describe.skip

integration("deployment control PostgreSQL boundary", () => {
  let admin: Sql
  let appA: Sql
  let appB: Sql

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 })
    appA = postgres(appUrl!, { max: 1 })
    appB = postgres(appUrl!, { max: 1 })
    await admin`truncate table deployment_entitlement_history restart identity`
    await admin`truncate table deployment_control_state`
    await admin`insert into deployment_control_state (singleton, current_revision) values (1, 0)`
  })

  afterAll(async () => {
    await Promise.all([admin.end(), appA.end(), appB.end()])
  })

  async function apply(client: Sql, revision: number, canonicalEnvelope = `envelope-${revision}`) {
    const issuedAt = new Date(`2026-08-${String(10 + revision).padStart(2, "0")}T00:00:00.000Z`)
    return client`
      select * from apply_verified_deployment_entitlement(
        ${"quandatics-production"}, ${"quandatics-production"}, ${revision},
        ${canonicalEnvelope}, ${`payload-${revision}`}, ${"a".repeat(64)},
        ${"vendor-key"}, ${"signature"}, ${issuedAt},
        ${new Date(issuedAt.getTime() + 24 * 60 * 60 * 1_000)},
        ${new Date("2026-08-01T00:00:00.000Z")}, ${new Date("2027-08-01T00:00:00.000Z")},
        ${new Date(issuedAt.getTime() + 8 * 24 * 60 * 60 * 1_000)},
        ${"active"}::deployment_subscription_status, ${25},
        ${"{projects}"}::text[], ${new Date()}
      )
    ` as unknown as Array<{ outcome: string; reason: string; current_revision: string }>
  }

  it("serializes concurrent applies, rejects rollback/conflict, and permits exact replay", async () => {
    await Promise.all([apply(appA, 2), apply(appB, 3)])
    const [state] = await appA`select * from read_deployment_entitlement_state()`
    expect(Number(state.current_revision)).toBe(3)
    expect(state.canonical_envelope).toBe("envelope-3")

    await expect(apply(appA, 3)).resolves.toMatchObject([{ outcome: "idempotent", reason: "idempotent_replay" }])
    await expect(apply(appA, 3, "conflicting-envelope")).resolves.toMatchObject([{ outcome: "rejected", reason: "revision_conflict" }])
    await expect(apply(appA, 1)).resolves.toMatchObject([{ outcome: "rejected", reason: "revision_downgrade" }])

    const [retained] = await appA`select * from read_deployment_entitlement_state()`
    expect(Number(retained.current_revision)).toBe(3)
    expect(retained.canonical_envelope).toBe("envelope-3")
  })

  it("keeps history append-only and blocks direct app-role table access", async () => {
    await appA`select record_deployment_entitlement_rejection(${"test_rejection"}, ${"b".repeat(64)}, ${null}, ${new Date()})`
    const [history] = await admin`select id from deployment_entitlement_history order by id limit 1`
    await expect(admin`update deployment_entitlement_history set reason = 'changed' where id = ${history.id}`).rejects.toThrow(/append-only/)
    await expect(admin`delete from deployment_entitlement_history where id = ${history.id}`).rejects.toThrow(/append-only/)
    await expect(appA`select * from deployment_control_state`).rejects.toThrow(/permission denied/)
    await expect(appA`insert into deployment_entitlement_history (outcome, reason, envelope_digest, received_at) values ('rejected', 'bypass', ${"b".repeat(64)}, now())`).rejects.toThrow(/permission denied/)
  })

  it("applies and reads a signed lease through the production PostgreSQL persistence", async () => {
    await admin`truncate table deployment_entitlement_history restart identity`
    await admin`truncate table deployment_control_state`
    await admin`insert into deployment_control_state (singleton, current_revision) values (1, 0)`

    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey)
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const lease: EntitlementLease = {
      schemaVersion: 1,
      revision: 5,
      keyId: "vendor-test",
      leaseId: "lease-production-persistence",
      clientId: "quandatics",
      deploymentId: "quandatics-production",
      issuedAt: "2026-08-10T00:00:00.000Z",
      leaseExpiresAt: "2026-08-11T00:00:00.000Z",
      contractStartsAt: "2026-08-01T00:00:00.000Z",
      contractEndsAt: "2027-08-01T00:00:00.000Z",
      graceUntil: "2026-08-18T00:00:00.000Z",
      subscriptionStatus: "active",
      planId: "professional",
      maxActiveUsers: 25,
      moduleIds: ["projects"],
      addonIds: [],
      configurationVersion: "config-1",
      releaseChannel: "stable",
      minimumSupportedAppVersion: "1.0.0",
    }
    const database = drizzle(appA) as unknown as typeof db
    const service = createDeploymentControlService({
      persistence: createPostgresDeploymentControlPersistence(database),
      trustSet: {
        version: 1,
        keys: [{
          keyId: "vendor-test",
          publicJwk,
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2027-01-01T00:00:00.000Z",
        }],
      },
    })

    await expect(service.applySignedEntitlement(
      await signEnvelope(lease, lease.keyId, privateJwk),
      lease.deploymentId,
    )).resolves.toMatchObject({ outcome: "accepted", revision: 5 })
    await expect(service.getDeploymentAccess(new Date("2026-08-10T12:00:00.000Z"))).resolves.toMatchObject({
      mode: "active",
      writeAllowed: true,
      revision: 5,
      seatLimit: 25,
      moduleIds: ["projects"],
    })
  })
})
