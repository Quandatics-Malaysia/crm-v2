import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  publishAfterSuccessfulMigration,
  publishAppliedMigrationVersion,
  readActualAppliedMigrationVersion,
} from "@/db/migration-version"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const databaseTestsRequired = process.env.REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS === "1"
const integration = adminUrl && appUrl ? describe.sequential : databaseTestsRequired ? describe.sequential : describe.skip
const prefix = "task3-status-test-"
const localJournal = {
  entries: [
    { idx: 66, when: 1_786_368_000_000, tag: "0066_deployment_control" },
    { idx: 67, when: 1_786_381_200_000, tag: "0067_deployment_status" },
    { idx: 68, when: 1_786_467_600_000, tag: "0068_deployment_seats" },
    { idx: 69, when: 1_786_554_000_000, tag: "0069_deployment_seat_authority" },
    { idx: 70, when: 1_786_640_400_000, tag: "0070_organization_archive" },
  ],
}

integration("deployment status PostgreSQL boundary", () => {
  let admin: Sql
  let app: Sql

  beforeAll(() => {
    if (!adminUrl || !appUrl) throw new Error("Deployment status PostgreSQL tests require database URLs")
    admin = postgres(adminUrl!, { max: 1 })
    app = postgres(appUrl!, { max: 1 })
  })

  beforeEach(async () => {
    await admin`delete from deployment_seat_reservations where normalized_email like ${`${prefix}%`}`
    await admin`delete from "user" where id like ${`${prefix}%`}`
    await admin`delete from organization where id like ${`${prefix}%`}`
  })

  afterAll(async () => {
    if (admin && app) {
      await admin`delete from deployment_seat_reservations where normalized_email like ${`${prefix}%`}`
      await admin`delete from "user" where id like ${`${prefix}%`}`
      await admin`delete from organization where id like ${`${prefix}%`}`
      await Promise.all([admin.end(), app.end()])
    }
  })

  it("counts active cc and qar tenants while excluding archived demo memberships and invitations", async () => {
    const [before] = await app`select * from read_deployment_status_rollup()`
    await admin`
      insert into organization (id, name, slug, status, archived_at, created_at)
      values
        (${`${prefix}cc`}, ${"CC"}, ${`${prefix}cc`}, 'active', null, now()),
        (${`${prefix}qar`}, ${"QAR"}, ${`${prefix}qar`}, 'active', null, now()),
        (${`${prefix}demo`}, ${"Demo"}, ${`${prefix}demo`}, 'archived', now(), now())
    `
    await admin`
      insert into "user" (id, name, email, email_verified, is_superadmin, is_vendor_support, created_at, updated_at)
      values
        (${`${prefix}user-a`}, ${"A"}, ${`${prefix}a@example.com`}, true, false, false, now(), now()),
        (${`${prefix}user-b`}, ${"B"}, ${`${prefix}b@example.com`}, true, false, false, now(), now()),
        (${`${prefix}support`}, ${"Support"}, ${`${prefix}support@example.com`}, true, false, true, now(), now()),
        (${`${prefix}disabled`}, ${"Disabled"}, ${`${prefix}disabled@example.com`}, true, false, false, now(), now()),
        (${`${prefix}demo-user`}, ${"Demo"}, ${`${prefix}demo@example.com`}, true, false, false, now(), now())
    `
    await admin`
      insert into member (id, organization_id, user_id, role, created_at)
      values
        (${`${prefix}member-a1`}, ${`${prefix}cc`}, ${`${prefix}user-a`}, ${"member"}, now()),
        (${`${prefix}member-a2`}, ${`${prefix}qar`}, ${`${prefix}user-a`}, ${"member"}, now()),
        (${`${prefix}member-b`}, ${`${prefix}cc`}, ${`${prefix}user-b`}, ${"member"}, now()),
        (${`${prefix}member-support`}, ${`${prefix}cc`}, ${`${prefix}support`}, ${"member"}, now()),
        (${`${prefix}member-disabled`}, ${`${prefix}cc`}, ${`${prefix}disabled`}, ${"member"}, now()),
        (${`${prefix}member-demo`}, ${`${prefix}demo`}, ${`${prefix}demo-user`}, ${"member"}, now())
    `
    await admin`
      insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at)
      values
        (${`${prefix}member-a1`}, ${`${prefix}cc`}, 'active', 0, now(), now()),
        (${`${prefix}member-a2`}, ${`${prefix}qar`}, 'active', 0, now(), now()),
        (${`${prefix}member-b`}, ${`${prefix}cc`}, 'active', 0, now(), now()),
        (${`${prefix}member-support`}, ${`${prefix}cc`}, 'active', 0, now(), now()),
        (${`${prefix}member-disabled`}, ${`${prefix}cc`}, 'disabled', 0, now(), now()),
        (${`${prefix}member-demo`}, ${`${prefix}demo`}, 'active', 0, now(), now())
    `
    await admin`
      insert into pending_invites (id, tenant_id, email, normalized_email, expires_at, tier_level, created_at, updated_at)
      values
        ('00000000-0000-4000-8000-000000000071', ${`${prefix}cc`}, ${`${prefix}invite-one@example.com`}, ${`${prefix}invite-one@example.com`}, now() + interval '1 day', 0, now(), now()),
        ('00000000-0000-4000-8000-000000000072', ${`${prefix}cc`}, ${`${prefix}invite-two@example.com`}, ${`${prefix}invite-two@example.com`}, now() + interval '2 days', 0, now(), now()),
        ('00000000-0000-4000-8000-000000000073', ${`${prefix}cc`}, ${`${prefix}a@example.com`}, ${`${prefix}a@example.com`}, now() + interval '2 days', 0, now(), now()),
        ('00000000-0000-4000-8000-000000000074', ${`${prefix}qar`}, ${`${prefix}other@example.com`}, ${`${prefix}other@example.com`}, now() + interval '2 days', 0, now(), now()),
        ('00000000-0000-4000-8000-000000000075', ${`${prefix}demo`}, ${`${prefix}demo-invite@example.com`}, ${`${prefix}demo-invite@example.com`}, now() + interval '2 days', 0, now(), now())
    `
    await admin`
      insert into deployment_seat_reservations (
        invitation_id, normalized_email, status, expires_at, released_at, expired_at
      )
      values
        ('00000000-0000-4000-8000-000000000071', ${`${prefix}invite-one@example.com`}, 'reserved', now() + interval '1 day', null, null),
        ('00000000-0000-4000-8000-000000000072', ${`${prefix}invite-two@example.com`}, 'reserved', now() + interval '2 days', null, null),
        ('00000000-0000-4000-8000-000000000073', ${`${prefix}a@example.com`}, 'reserved', now() + interval '2 days', null, null),
        (${`${prefix}invite-expired`}, ${`${prefix}expired@example.com`}, 'expired', now(), null, now()),
        (${`${prefix}invite-released`}, ${`${prefix}released@example.com`}, 'released', now() + interval '2 days', now(), null),
        ('00000000-0000-4000-8000-000000000074', ${`${prefix}other@example.com`}, 'reserved', now() + interval '2 days', null, null),
        ('00000000-0000-4000-8000-000000000075', ${`${prefix}demo-invite@example.com`}, 'reserved', now() + interval '2 days', null, null)
    `

    const [after] = await app`select * from read_deployment_status_rollup()`
    expect(Number(after.active_user_count) - Number(before.active_user_count)).toBe(2)
    expect(Number(after.reserved_invitation_count) - Number(before.reserved_invitation_count)).toBe(3)
    expect(after.applied_migration_version).toBe("0070")
  })

  it("keeps reservation identities private and exposes only the safe rollup to crm_app", async () => {
    await expect(app`select * from deployment_seat_reservations`).rejects.toThrow(/permission denied/)
    await expect(app`select * from deployment_runtime_metadata`).rejects.toThrow(/permission denied/)
    const [rollup] = await app`select * from read_deployment_status_rollup()`
    expect(Object.keys(rollup).sort()).toEqual([
      "active_user_count",
      "applied_migration_version",
      "reserved_invitation_count",
    ])
    const [security] = await admin`
      select relrowsecurity, relforcerowsecurity
      from pg_class where oid = 'deployment_seat_reservations'::regclass
    `
    expect(security).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
  })

  it("publishes migration versions monotonically across upgrade, replay, and an older image", async () => {
    try {
      await publishAppliedMigrationVersion(admin, "0070")
      await publishAppliedMigrationVersion(admin, "0070")
      await publishAppliedMigrationVersion(admin, "0068")
      const [rollup] = await app`select * from read_deployment_status_rollup()`
      expect(rollup.applied_migration_version).toBe("0070")

      await publishAppliedMigrationVersion(admin, "0099")
      await publishAppliedMigrationVersion(admin, "0100")
      await publishAppliedMigrationVersion(admin, "0099")
      const [numericBoundaryRollup] = await app`select * from read_deployment_status_rollup()`
      expect(numericBoundaryRollup.applied_migration_version).toBe("0100")
    } finally {
      await admin`update deployment_runtime_metadata set migration_version = '0070' where singleton = 1`
    }
  })

  it("rolls publication back with its database transaction", async () => {
    const [before] = await admin`select migration_version, published_at from deployment_runtime_metadata where singleton = 1`
    await expect(admin.begin(async (transaction) => {
      await publishAppliedMigrationVersion(transaction as unknown as Sql, "0070")
      throw new Error("simulated failed release transaction")
    })).rejects.toThrow("simulated failed release transaction")
    const [after] = await admin`select migration_version, published_at from deployment_runtime_metadata where singleton = 1`
    expect(after).toEqual(before)
  })

  it("requires trustworthy ahead metadata before tolerating future migration history", async () => {
    try {
      await admin`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values ('task4-future-0071-test', 1786726800000)
      `
      await expect(readActualAppliedMigrationVersion(admin, localJournal)).rejects.toThrow(
        "Invalid future migration metadata",
      )

      await admin`delete from deployment_runtime_metadata where singleton = 1`
      await expect(readActualAppliedMigrationVersion(admin, localJournal)).rejects.toThrow(
        "Invalid future migration metadata",
      )

      await admin`
        insert into deployment_runtime_metadata (singleton, migration_version)
        values (1, '0071')
      `
      await expect(readActualAppliedMigrationVersion(admin, localJournal)).resolves.toBeNull()
      await admin`update deployment_runtime_metadata set migration_version = '0072' where singleton = 1`
      await expect(readActualAppliedMigrationVersion(admin, localJournal)).resolves.toBeNull()
    } finally {
      await admin`delete from drizzle.__drizzle_migrations where hash = 'task4-future-0071-test'`
      await admin`
        insert into deployment_runtime_metadata (singleton, migration_version)
        values (1, '0070')
        on conflict (singleton) do update set migration_version = excluded.migration_version
      `
    }
  })

  it("fails when a conflicting metadata row prevents publication", async () => {
    try {
      await admin`update deployment_runtime_metadata set migration_version = '0071' where singleton = 1`
      await expect(publishAfterSuccessfulMigration(
        async () => undefined,
        () => readActualAppliedMigrationVersion(admin, localJournal),
        (version) => publishAppliedMigrationVersion(admin, version),
      )).rejects.toThrow("Applied migration version was not published")
    } finally {
      await admin`update deployment_runtime_metadata set migration_version = '0070' where singleton = 1`
    }
  })
})
