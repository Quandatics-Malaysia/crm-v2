import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { publishAppliedMigrationVersion } from "@/db/migration-version"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const databaseTestsRequired = process.env.REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS === "1"
const integration = adminUrl && appUrl ? describe.sequential : databaseTestsRequired ? describe.sequential : describe.skip
const prefix = "task3-status-test-"

integration("deployment status PostgreSQL boundary", () => {
  let admin: Sql
  let app: Sql

  beforeAll(() => {
    if (!adminUrl || !appUrl) throw new Error("Deployment status PostgreSQL tests require database URLs")
    admin = postgres(adminUrl!, { max: 1 })
    app = postgres(appUrl!, { max: 1 })
  })

  beforeEach(async () => {
    await admin`delete from deployment_seat_reservations where invitation_id like ${`${prefix}%`}`
    await admin`delete from "user" where id like ${`${prefix}%`}`
    await admin`delete from organization where id like ${`${prefix}%`}`
  })

  afterAll(async () => {
    if (admin && app) {
      await admin`delete from deployment_seat_reservations where invitation_id like ${`${prefix}%`}`
      await admin`delete from "user" where id like ${`${prefix}%`}`
      await admin`delete from organization where id like ${`${prefix}%`}`
      await Promise.all([admin.end(), app.end()])
    }
  })

  it("counts distinct active users across organizations and distinct live reservation identities", async () => {
    const [before] = await app`select * from read_deployment_status_rollup()`
    await admin`
      insert into organization (id, name, slug, created_at)
      values
        (${`${prefix}org-a`}, ${"Task 3 A"}, ${`${prefix}org-a`}, now()),
        (${`${prefix}org-b`}, ${"Task 3 B"}, ${`${prefix}org-b`}, now())
    `
    await admin`
      insert into "user" (id, name, email, email_verified, is_superadmin, created_at, updated_at)
      values
        (${`${prefix}user-a`}, ${"A"}, ${`${prefix}a@example.com`}, true, false, now(), now()),
        (${`${prefix}user-b`}, ${"B"}, ${`${prefix}b@example.com`}, true, false, now(), now()),
        (${`${prefix}support`}, ${"Support"}, ${`${prefix}support@example.com`}, true, true, now(), now()),
        (${`${prefix}disabled`}, ${"Disabled"}, ${`${prefix}disabled@example.com`}, true, false, now(), now())
    `
    await admin`
      insert into member (id, organization_id, user_id, role, created_at)
      values
        (${`${prefix}member-a1`}, ${`${prefix}org-a`}, ${`${prefix}user-a`}, ${"member"}, now()),
        (${`${prefix}member-a2`}, ${`${prefix}org-b`}, ${`${prefix}user-a`}, ${"member"}, now()),
        (${`${prefix}member-b`}, ${`${prefix}org-a`}, ${`${prefix}user-b`}, ${"member"}, now()),
        (${`${prefix}member-support`}, ${`${prefix}org-a`}, ${`${prefix}support`}, ${"member"}, now()),
        (${`${prefix}member-disabled`}, ${`${prefix}org-a`}, ${`${prefix}disabled`}, ${"member"}, now())
    `
    await admin`
      insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at)
      values
        (${`${prefix}member-a1`}, ${`${prefix}org-a`}, 'active', 0, now(), now()),
        (${`${prefix}member-a2`}, ${`${prefix}org-b`}, 'active', 0, now(), now()),
        (${`${prefix}member-b`}, ${`${prefix}org-a`}, 'active', 0, now(), now()),
        (${`${prefix}member-support`}, ${`${prefix}org-a`}, 'active', 0, now(), now()),
        (${`${prefix}member-disabled`}, ${`${prefix}org-a`}, 'disabled', 0, now(), now())
    `
    await admin`
      insert into deployment_seat_reservations (invitation_id, normalized_email, status, expires_at)
      values
        (${`${prefix}invite-dup-1`}, ${`${prefix}invite@example.com`}, 'reserved', now() + interval '1 day'),
        (${`${prefix}invite-dup-2`}, ${`${prefix}invite@example.com`}, 'reserved', now() + interval '2 days'),
        (${`${prefix}invite-active`}, ${`${prefix}a@example.com`}, 'reserved', now() + interval '2 days'),
        (${`${prefix}invite-expired`}, ${`${prefix}expired@example.com`}, 'reserved', now()),
        (${`${prefix}invite-released`}, ${`${prefix}released@example.com`}, 'released', now() + interval '2 days'),
        (${`${prefix}invite-other`}, ${`${prefix}other@example.com`}, 'reserved', now() + interval '2 days')
    `

    const [after] = await app`select * from read_deployment_status_rollup()`
    expect(Number(after.active_user_count) - Number(before.active_user_count)).toBe(2)
    expect(Number(after.reserved_invitation_count) - Number(before.reserved_invitation_count)).toBe(2)
    expect(after.applied_migration_version).toBe("0067")
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

  it("reports a later successfully published migration version without changing the rollup function", async () => {
    try {
      await publishAppliedMigrationVersion(admin, "0068")
      const [rollup] = await app`select * from read_deployment_status_rollup()`
      expect(rollup.applied_migration_version).toBe("0068")
    } finally {
      await admin`update deployment_runtime_metadata set migration_version = '0067' where singleton = 1`
    }
  })
})
