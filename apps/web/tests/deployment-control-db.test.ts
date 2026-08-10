import { signEnvelope, type EntitlementLease } from "@crm/control-protocol"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { db } from "@/db"
import {
  createDeploymentControlService,
  createPostgresDeploymentControlPersistence,
} from "@/lib/deployment-control"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const databaseTestsRequired = process.env.REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS === "1"
const integration = adminUrl && appUrl ? describe : databaseTestsRequired ? describe : describe.skip

integration("deployment control PostgreSQL boundary", () => {
  let admin: Sql
  let appA: Sql
  let appB: Sql

  beforeAll(async () => {
    if (!adminUrl || !appUrl) {
      throw new Error("Deployment control PostgreSQL tests require TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL")
    }
    admin = postgres(adminUrl!, { max: 1 })
    appA = postgres(appUrl!, { max: 1 })
    appB = postgres(appUrl!, { max: 1 })
    await admin.unsafe(`
      CREATE TABLE deployment_control_state_update_probe (
        singleton boolean PRIMARY KEY DEFAULT true,
        writes integer NOT NULL DEFAULT 0
      );
      INSERT INTO deployment_control_state_update_probe DEFAULT VALUES;
      CREATE FUNCTION count_deployment_control_state_update()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $$
      BEGIN
        UPDATE public.deployment_control_state_update_probe SET writes = writes + 1 WHERE singleton;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER deployment_control_state_update_probe_trigger
      AFTER UPDATE ON deployment_control_state
      FOR EACH ROW EXECUTE FUNCTION count_deployment_control_state_update();
    `)
  })

  beforeEach(async () => {
    await admin`truncate table deployment_entitlement_history restart identity`
    await admin`truncate table deployment_control_state`
    await admin`insert into deployment_control_state (singleton, current_revision) values (1, 0)`
    await admin`update deployment_control_state_update_probe set writes = 0 where singleton`
  })

  afterAll(async () => {
    if (admin && appA && appB) {
      await admin.unsafe(`
        DROP TRIGGER deployment_control_state_update_probe_trigger ON deployment_control_state;
        DROP FUNCTION count_deployment_control_state_update();
        DROP TABLE deployment_control_state_update_probe;
      `)
      await Promise.all([admin.end(), appA.end(), appB.end()])
    }
  })

  async function apply(client: Sql, revision: number, canonicalEnvelope = `envelope-${revision}`) {
    const issuedAt = new Date(`2026-08-${String(10 + revision).padStart(2, "0")}T00:00:00.000Z`)
    return client`
      select * from apply_verified_deployment_entitlement(
        ${"quandatics-production"}, ${"quandatics-production"}, ${revision},
        ${canonicalEnvelope}, ${`payload-${revision}`}, ${"a".repeat(64)},
        ${"vendor-key"}, ${"signature"}, ${issuedAt.toISOString()},
        ${new Date(issuedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString()},
        ${"2026-08-01T00:00:00.000Z"}, ${"2027-08-01T00:00:00.000Z"},
        ${new Date(issuedAt.getTime() + 8 * 24 * 60 * 60 * 1_000).toISOString()},
        ${"active"}::deployment_subscription_status, ${25},
        ${"{projects}"}::text[], ${new Date().toISOString()}
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
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey)
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const lease: EntitlementLease = {
      schemaVersion: 2,
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

  it("persists delayed apply receipt time as the greatest trusted clock", async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey)
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const lease: EntitlementLease = {
      schemaVersion: 2,
      revision: 1,
      keyId: "vendor-clock",
      leaseId: "lease-delayed",
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
          keyId: lease.keyId,
          publicJwk,
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2027-01-01T00:00:00.000Z",
        }],
      },
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    })

    await expect(service.applySignedEntitlement(
      await signEnvelope(lease, lease.keyId, privateJwk), lease.deploymentId,
    )).resolves.toMatchObject({ outcome: "accepted" })
    const [state] = await admin`select greatest_trusted_at from deployment_control_state where singleton = 1`
    expect(state.greatest_trusted_at.toISOString()).toBe("2026-08-12T00:00:00.000Z")
  })

  it("advances trusted time on a byte-identical idempotent replay", async () => {
    const invoke = (receivedAt: string) => appA`
      select * from apply_verified_deployment_entitlement(
        ${"quandatics-production"}, ${"quandatics-production"}, ${1},
        ${"identical-envelope"}, ${"payload-1"}, ${"a".repeat(64)},
        ${"vendor-key"}, ${"signature"}, ${"2026-08-11T00:00:00.000Z"},
        ${"2026-08-12T00:00:00.000Z"}, ${"2026-08-01T00:00:00.000Z"},
        ${"2027-08-01T00:00:00.000Z"}, ${"2026-08-19T00:00:00.000Z"},
        ${"active"}::deployment_subscription_status, ${25},
        ${"{projects}"}::text[], ${receivedAt}
      )
    `
    await invoke("2026-08-11T00:00:00.000Z")

    const replayReceivedAt = new Date("2026-08-17T00:00:00.000Z")
    const rows = await invoke(replayReceivedAt.toISOString())
    expect(rows).toMatchObject([{ outcome: "idempotent" }])
    const [state] = await admin`select greatest_trusted_at from deployment_control_state where singleton = 1`
    expect(state.greatest_trusted_at.toISOString()).toBe(replayReceivedAt.toISOString())
  })

  it("keeps repeated and concurrent access reads within the checkpoint interval write-free", async () => {
    await apply(appA, 1)
    await admin`update deployment_control_state_update_probe set writes = 0 where singleton`
    const [before] = await admin`
      select xmin::text as xmin, ctid::text as ctid, greatest_trusted_at
      from deployment_control_state where singleton = 1
    `
    const observedAt = new Date(before.greatest_trusted_at.getTime() + 59_999).toISOString()

    await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 === 0 ? appA : appB)`select * from read_deployment_entitlement_state(${observedAt})`))

    const [after] = await admin`
      select xmin::text as xmin, ctid::text as ctid, greatest_trusted_at
      from deployment_control_state where singleton = 1
    `
    const [probe] = await admin`select writes from deployment_control_state_update_probe where singleton`
    expect(probe.writes).toBe(0)
    expect(after).toMatchObject({ xmin: before.xmin, ctid: before.ctid })
    expect(after.greatest_trusted_at.toISOString()).toBe(before.greatest_trusted_at.toISOString())
  })

  it("uses a CAS checkpoint so concurrent boundary readers produce one durable write", async () => {
    await apply(appA, 1)
    await admin`update deployment_control_state_update_probe set writes = 0 where singleton`
    const [before] = await admin`
      select greatest_trusted_at from deployment_control_state where singleton = 1
    `
    const observedAt = new Date(before.greatest_trusted_at.getTime() + 60_000).toISOString()

    await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 === 0 ? appA : appB)`select * from read_deployment_entitlement_state(${observedAt})`))

    const [after] = await admin`
      select greatest_trusted_at from deployment_control_state where singleton = 1
    `
    const [probe] = await admin`select writes from deployment_control_state_update_probe where singleton`
    expect(probe.writes).toBe(1)
    expect(after.greatest_trusted_at.toISOString()).toBe(observedAt)
  })

  it("durably advances access time so a later host rollback cannot regain writes", async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey)
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const lease: EntitlementLease = {
      schemaVersion: 2,
      revision: 1,
      keyId: "vendor-clock",
      leaseId: "lease-access-clock",
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
    let observedAt = new Date("2026-08-17T23:59:00.000Z")
    const service = createDeploymentControlService({
      persistence: createPostgresDeploymentControlPersistence(database),
      trustSet: {
        version: 1,
        keys: [{
          keyId: lease.keyId,
          publicJwk,
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2027-01-01T00:00:00.000Z",
        }],
      },
      now: () => observedAt,
    })
    await service.applySignedEntitlement(await signEnvelope(lease, lease.keyId, privateJwk), lease.deploymentId)

    observedAt = new Date("2026-08-17T23:59:59.999Z")
    await expect(service.getDeploymentAccess(observedAt)).resolves.toMatchObject({ mode: "grace" })
    const [withinCheckpoint] = await admin`select greatest_trusted_at from deployment_control_state where singleton = 1`
    expect(withinCheckpoint.greatest_trusted_at.toISOString()).toBe("2026-08-17T23:59:00.000Z")

    observedAt = new Date("2026-08-18T00:00:00.001Z")
    await expect(service.getDeploymentAccess(observedAt)).resolves.toMatchObject({ mode: "read_only" })
    const [advanced] = await admin`select greatest_trusted_at from deployment_control_state where singleton = 1`
    expect(advanced.greatest_trusted_at.toISOString()).toBe(observedAt.toISOString())

    await expect(service.getDeploymentAccess(new Date("2026-08-10T00:00:00.000Z"))).resolves.toMatchObject({
      mode: "read_only",
      writeAllowed: false,
    })
  })

  it("does not advance trusted time or replace state for invalid input", async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey)
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
    const lease: EntitlementLease = {
      schemaVersion: 2,
      revision: 1,
      keyId: "vendor-clock",
      leaseId: "lease-invalid-clock",
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
    let observedAt = new Date("2026-08-12T00:00:00.000Z")
    const service = createDeploymentControlService({
      persistence: createPostgresDeploymentControlPersistence(database),
      trustSet: {
        version: 1,
        keys: [{
          keyId: lease.keyId,
          publicJwk,
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2027-01-01T00:00:00.000Z",
        }],
      },
      now: () => observedAt,
    })
    const envelope = await signEnvelope(lease, lease.keyId, privateJwk)
    await service.applySignedEntitlement(envelope, lease.deploymentId)
    const canonicalBefore = (await admin`select canonical_envelope from deployment_control_state where singleton = 1`)[0].canonical_envelope

    observedAt = new Date("2026-08-17T00:00:00.000Z")
    const tampered = structuredClone(envelope)
    tampered.payload.maxActiveUsers = 99
    await expect(service.applySignedEntitlement(tampered, lease.deploymentId)).resolves.toMatchObject({ outcome: "rejected" })
    const [state] = await admin`select canonical_envelope, greatest_trusted_at from deployment_control_state where singleton = 1`
    expect(state.canonical_envelope).toBe(canonicalBefore)
    expect(state.greatest_trusted_at.toISOString()).toBe("2026-08-12T00:00:00.000Z")
  })
})
