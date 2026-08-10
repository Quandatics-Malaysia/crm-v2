import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const required = process.env.REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS === "1"
const integration = adminUrl && appUrl ? describe.sequential : required ? describe.sequential : describe.skip
const prefix = "task4-seat-test-"

integration("deployment seat PostgreSQL boundary", () => {
  let admin: Sql
  let app: Sql

  beforeAll(() => {
    if (!adminUrl || !appUrl) throw new Error("Deployment seat PostgreSQL tests require database URLs")
    admin = postgres(adminUrl, { max: 2 })
    app = postgres(appUrl, { max: 2 })
  })

  beforeEach(async () => {
    await admin`delete from deployment_seat_reservations where normalized_email like ${`${prefix}%`}`
    await admin`delete from pending_invites where email like ${`${prefix}%`}`
    await admin`delete from "user" where id like ${`${prefix}%`}`
    await admin`delete from organization where id like ${`${prefix}%`}`
    await admin`
      update deployment_control_state set
        deployment_id = '11111111-1111-4111-8111-111111111111',
        current_revision = 1,
        canonical_envelope = '{}', canonical_payload = '{}', envelope_digest = repeat('a', 64),
        key_id = 'test-key', signature = 'test-signature',
        issued_at = '2026-08-11T00:00:00Z', lease_expires_at = '2026-08-12T00:00:00Z',
        contract_starts_at = '2026-08-01T00:00:00Z', contract_ends_at = '2027-08-01T00:00:00Z',
        grace_until = '2026-08-19T00:00:00Z', subscription_status = 'active',
        seat_limit = 1, module_ids = '{}', greatest_trusted_at = '2026-08-11T00:00:00Z',
        accepted_at = '2026-08-11T00:00:00Z'
      where singleton = 1
    `
    await admin`
      insert into organization (id, name, slug, created_at)
      values (${`${prefix}org`}, 'Task 4', ${`${prefix}org`}, now())
    `
  })

  afterAll(async () => {
    if (admin && app) {
      await admin`delete from deployment_seat_reservations where normalized_email like ${`${prefix}%`}`
      await admin`delete from pending_invites where email like ${`${prefix}%`}`
      await admin`delete from "user" where id like ${`${prefix}%`}`
      await admin`delete from organization where id like ${`${prefix}%`}`
      await Promise.all([admin.end(), app.end()])
    }
  })

  it("installs the singleton mutex, canonical identity columns, lifecycle timestamps, and support marker", async () => {
    const columns = await admin`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'deployment_seat_state' and column_name = 'singleton') or
        (table_name = 'pending_invites' and column_name in ('normalized_email', 'expires_at')) or
        (table_name = 'deployment_seat_reservations' and column_name in ('consumed_user_id', 'consumed_at', 'released_at', 'expired_at')) or
        (table_name = 'user' and column_name = 'is_vendor_support')
      )
    `
    expect(columns).toHaveLength(8)
    await expect(app`select * from deployment_seat_state`).rejects.toThrow(/permission denied/)
    await expect(app`select * from deployment_seat_reservations`).rejects.toThrow(/permission denied/)
  })

  it("serializes two final-seat reservations so exactly one commits", async () => {
    async function reserve(suffix: string) {
      return app.begin(async (tx) => {
        const invitationId = suffix
        const email = `${prefix}${suffix}@example.com`
        const [decision] = await tx`
          select * from reserve_deployment_seat(
            ${invitationId}, ${email}, '2026-08-18T00:00:00Z', '2026-08-11T01:00:00Z'
          )
        `
        if (!decision.allowed) return decision
        await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
        await tx`
          insert into pending_invites (id, tenant_id, email, normalized_email, expires_at, tier_level, created_at, updated_at)
          values (${invitationId}::uuid, ${`${prefix}org`}, ${email}, ${email}, '2026-08-18T00:00:00Z', 0, now(), now())
        `
        return decision
      })
    }

    const decisions = await Promise.all([reserve("00000000-0000-4000-8000-000000000001"), reserve("00000000-0000-4000-8000-000000000002")])
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1)
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1)
    const [usage] = await app`select * from read_deployment_seat_usage('2026-08-11T01:00:00Z')`
    expect(Number(usage.occupied_user_count)).toBe(0)
    expect(Number(usage.reserved_invitation_count)).toBe(1)
    expect(Number(usage.seat_limit)).toBe(1)
  })

  it("deduplicates canonical invitation identities and releases only the last live reservation", async () => {
    const email = `${prefix}dedupe@example.com`
    const first = "00000000-0000-4000-8000-000000000011"
    const second = "00000000-0000-4000-8000-000000000012"
    expect((await app`select * from reserve_deployment_seat(${first}, ${email}, '2026-08-18', '2026-08-11')`)[0].allowed).toBe(true)
    expect((await app`select * from reserve_deployment_seat(${second}, ${email}, '2026-08-18', '2026-08-11')`)[0].allowed).toBe(true)
    expect(Number((await app`select * from read_deployment_seat_usage('2026-08-11')`)[0].reserved_invitation_count)).toBe(1)

    expect((await app`select * from release_deployment_invitation_seat(${first}, '2026-08-11')`)[0].allowed).toBe(true)
    expect(Number((await app`select * from read_deployment_seat_usage('2026-08-11')`)[0].reserved_invitation_count)).toBe(1)
    expect((await app`select * from release_deployment_invitation_seat(${first}, '2026-08-11')`)[0].reason).toBe("idempotent")
    await app`select * from release_deployment_invitation_seat(${second}, '2026-08-11')`
    expect(Number((await app`select * from read_deployment_seat_usage('2026-08-11')`)[0].reserved_invitation_count)).toBe(0)
  })

  it("counts a customer once across organizations, suppresses their email reservation, and excludes support", async () => {
    await admin`
      insert into organization (id, name, slug, created_at)
      values (${`${prefix}org-2`}, 'Task 4 other', ${`${prefix}org-2`}, now())
    `
    await admin`
      insert into "user" (id, name, email, email_verified, is_superadmin, is_vendor_support, created_at, updated_at)
      values
        (${`${prefix}customer`}, 'Customer', ${`${prefix}customer@example.com`}, true, false, false, now(), now()),
        (${`${prefix}support`}, 'Support', ${`${prefix}support@example.com`}, true, false, true, now(), now())
    `
    await admin`
      insert into member (id, organization_id, user_id, role, created_at) values
        (${`${prefix}customer-a`}, ${`${prefix}org`}, ${`${prefix}customer`}, 'member', now()),
        (${`${prefix}customer-b`}, ${`${prefix}org-2`}, ${`${prefix}customer`}, 'member', now()),
        (${`${prefix}support-member`}, ${`${prefix}org`}, ${`${prefix}support`}, 'member', now())
    `
    await admin`
      insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at) values
        (${`${prefix}customer-a`}, ${`${prefix}org`}, 'active', 0, now(), now()),
        (${`${prefix}customer-b`}, ${`${prefix}org-2`}, 'active', 0, now(), now()),
        (${`${prefix}support-member`}, ${`${prefix}org`}, 'active', 0, now(), now())
    `
    const decision = (await app`select * from reserve_deployment_seat(
      '00000000-0000-4000-8000-000000000021', ${`${prefix}customer@example.com`}, '2026-08-18', '2026-08-11'
    )`)[0]
    expect(decision.allowed).toBe(true)
    expect(Number(decision.occupied_user_count)).toBe(1)
    expect(Number(decision.reserved_invitation_count)).toBe(0)
  })

  it("permits active and grace writes but denies read-only and missing bundles", async () => {
    const decide = async (id: string) => (await app`select * from reserve_deployment_seat(
      ${id}, ${`${prefix}${id}@example.com`}, '2026-08-18', '2026-08-11T12:00:00Z'
    )`)[0]
    const active = await decide("active")
    expect(active.allowed).toBe(true)
    await app`select * from release_deployment_invitation_seat('active', '2026-08-11T12:00:00Z')`

    await admin`update deployment_control_state set lease_expires_at = '2026-08-11T01:00:00Z' where singleton = 1`
    const grace = await decide("grace")
    expect(grace.allowed).toBe(true)
    await app`select * from release_deployment_invitation_seat('grace', '2026-08-11T12:00:00Z')`

    await admin`update deployment_control_state set subscription_status = 'suspended' where singleton = 1`
    const readOnly = await decide("read-only")
    expect(readOnly.allowed).toBe(false)
    expect(readOnly.reason).toBe("read_only")

    await admin`update deployment_control_state set
      deployment_id = null, current_revision = 0, canonical_envelope = null, canonical_payload = null,
      envelope_digest = null, key_id = null, signature = null, issued_at = null, lease_expires_at = null,
      contract_starts_at = null, contract_ends_at = null, grace_until = null, subscription_status = null,
      seat_limit = null, module_ids = null, greatest_trusted_at = null, accepted_at = null
      where singleton = 1`
    const unknown = await decide("unknown")
    expect(unknown.allowed).toBe(false)
    expect(unknown.reason).toBe("unknown")
  })

  it("retains an existing overage, denies new occupancy, and denies reactivation at the exact ceiling", async () => {
    await admin`
      insert into "user" (id, name, email, email_verified, created_at, updated_at) values
        (${`${prefix}over-a`}, 'A', ${`${prefix}over-a@example.com`}, true, now(), now()),
        (${`${prefix}over-b`}, 'B', ${`${prefix}over-b@example.com`}, true, now(), now())
    `
    await admin`
      insert into member (id, organization_id, user_id, role, created_at) values
        (${`${prefix}over-member-a`}, ${`${prefix}org`}, ${`${prefix}over-a`}, 'member', now()),
        (${`${prefix}over-member-b`}, ${`${prefix}org`}, ${`${prefix}over-b`}, 'member', now())
    `
    await admin`
      insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at) values
        (${`${prefix}over-member-a`}, ${`${prefix}org`}, 'active', 0, now(), now()),
        (${`${prefix}over-member-b`}, ${`${prefix}org`}, 'active', 0, now(), now())
    `
    const usage = (await app`select * from read_deployment_seat_usage('2026-08-11')`)[0]
    expect(Number(usage.occupied_user_count)).toBe(2)
    expect(usage.overage).toBe(true)
    expect((await app`select * from reserve_deployment_seat('over-new', ${`${prefix}new@example.com`}, '2026-08-18', '2026-08-11')`)[0].allowed).toBe(false)

    await app.begin(async (tx) => {
      expect((await tx`select * from release_deployment_membership_seat(${`${prefix}over-member-b`}, '2026-08-11')`)[0].allowed).toBe(true)
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`update membership_profiles set status = 'disabled' where member_id = ${`${prefix}over-member-b`}`
    })
    const reactivation = (await app`select * from activate_deployment_seat(
      ${`${prefix}over-member-b`}, ${`${prefix}over-b`}, null, '2026-08-11'
    )`)[0]
    expect(reactivation.allowed).toBe(false)
    expect(reactivation.reason).toBe("seat_limit")
  })

  it("rejects vendor-support standing membership and direct crm_app seat bypasses", async () => {
    await admin`insert into "user" (id, name, email, email_verified, is_vendor_support, created_at, updated_at)
      values (${`${prefix}vendor`}, 'Vendor', ${`${prefix}vendor@example.com`}, true, true, now(), now())`
    const memberId = `${prefix}vendor-member`
    const decision = (await app`select * from activate_deployment_seat(${memberId}, ${`${prefix}vendor`}, null, '2026-08-11')`)[0]
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("vendor_support_no_membership")
    await app`insert into member (id, organization_id, user_id, role, created_at)
      values (${memberId}, ${`${prefix}org`}, ${`${prefix}vendor`}, 'member', now())`
    await expect(app.begin(async (tx) => {
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at)
        values (${memberId}, ${`${prefix}org`}, 'active', 0, now(), now())`
    })).rejects.toThrow(/deployment seat mutation must use/)
  })

  it("reconciles expired invitations idempotently and status ignores expiry without the job", async () => {
    const invitationId = "00000000-0000-4000-8000-000000000031"
    const email = `${prefix}expiry@example.com`
    await app.begin(async (tx) => {
      const [decision] = await tx`select * from reserve_deployment_seat(${invitationId}, ${email}, '2026-08-10', '2026-08-09')`
      expect(decision.allowed).toBe(true)
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`insert into pending_invites (id, tenant_id, email, normalized_email, expires_at, tier_level, created_at, updated_at)
        values (${invitationId}::uuid, ${`${prefix}org`}, ${email}, ${email}, '2026-08-10', 0, '2026-08-09', '2026-08-09')`
    })
    expect(Number((await app`select * from read_deployment_status_rollup()`)[0].reserved_invitation_count)).toBe(0)
    const first = (await app`select * from reconcile_expired_deployment_seat_reservations('2026-08-13')`)[0]
    expect(Number(first.expired_count)).toBe(1)
    expect(await admin`select id from pending_invites where id = ${invitationId}::uuid`).toHaveLength(0)
    expect(Number((await app`select * from reconcile_expired_deployment_seat_reservations('2026-08-13')`)[0].expired_count)).toBe(0)
  })
})
