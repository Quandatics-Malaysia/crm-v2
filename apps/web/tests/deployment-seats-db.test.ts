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

  async function reserve(tenantId: string, invitationId: string, email: string, now = "2026-08-11T01:00:00Z", expires = "2026-08-18T00:00:00Z") {
    return (await app`select * from reserve_deployment_invitation(
      ${invitationId}::uuid, ${tenantId}, ${email}, null, 0, null, null, null,
      ${expires}::timestamp with time zone, ${now}::timestamp with time zone
    )`)[0]
  }

  async function revoke(tenantId: string, invitationId: string, now = "2026-08-11T01:00:00Z") {
    return (await app`select * from revoke_deployment_invitation(
      ${tenantId}, ${invitationId}::uuid, null, null, ${now}::timestamp with time zone
    )`)[0]
  }

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
    await admin`update deployment_seat_state set last_reconciled_at = '1970-01-01' where singleton = 1`
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
        (table_name = 'deployment_seat_state' and column_name in ('singleton', 'last_reconciled_at')) or
        (table_name = 'pending_invites' and column_name in ('normalized_email', 'expires_at')) or
        (table_name = 'deployment_seat_reservations' and column_name in ('consumed_user_id', 'consumed_at', 'released_at', 'expired_at')) or
        (table_name = 'user' and column_name = 'is_vendor_support')
      )
    `
    expect(columns).toHaveLength(9)
    await expect(app`select * from deployment_seat_state`).rejects.toThrow(/permission denied/)
    await expect(app`select * from deployment_seat_reservations`).rejects.toThrow(/permission denied/)
  })

  it("serializes two final-seat reservations so exactly one commits", async () => {
    async function reserve(suffix: string) {
      return (await app`select * from reserve_deployment_invitation(
        ${suffix}::uuid, ${`${prefix}org`}, ${`${prefix}${suffix}@example.com`}, null, 0,
        null, null, null, '2026-08-18T00:00:00Z', '2026-08-11T01:00:00Z'
      )`)[0]
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
    await admin`update deployment_control_state set seat_limit = 2 where singleton = 1`
    await admin`insert into organization (id, name, slug, created_at)
      values (${`${prefix}dedupe-org`}, 'Dedupe', ${`${prefix}dedupe-org`}, now())`
    expect((await reserve(`${prefix}org`, first, email)).allowed).toBe(true)
    expect((await reserve(`${prefix}org`, first, email)).reason).toBe("idempotent")
    expect(await admin`select id from audit_log where action = 'member.invited' and entity_id = ${first}`).toHaveLength(1)
    expect((await reserve(`${prefix}dedupe-org`, second, email)).allowed).toBe(true)
    expect(Number((await app`select * from read_deployment_seat_usage('2026-08-11')`)[0].reserved_invitation_count)).toBe(1)

    expect((await revoke(`${prefix}org`, first)).allowed).toBe(true)
    expect(Number((await app`select * from read_deployment_seat_usage('2026-08-11')`)[0].reserved_invitation_count)).toBe(1)
    expect((await revoke(`${prefix}org`, first)).reason).toBe("idempotent")
    await revoke(`${prefix}dedupe-org`, second)
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
    const decision = await reserve(
      `${prefix}org`, "00000000-0000-4000-8000-000000000021", `${prefix}customer@example.com`, "2026-08-11",
    )
    expect(decision.allowed).toBe(true)
    expect(Number(decision.occupied_user_count)).toBe(1)
    expect(Number(decision.reserved_invitation_count)).toBe(0)
  })

  it("permits active and grace writes but denies read-only and missing bundles", async () => {
    const decide = async (id: string, suffix: string) => reserve(
      `${prefix}org`, id, `${prefix}${suffix}@example.com`, "2026-08-11T12:00:00Z",
    )
    const activeId = "00000000-0000-4000-8000-000000000041"
    const graceId = "00000000-0000-4000-8000-000000000042"
    const readOnlyId = "00000000-0000-4000-8000-000000000043"
    const unknownId = "00000000-0000-4000-8000-000000000044"
    const active = await decide(activeId, "active")
    expect(active.allowed).toBe(true)
    await revoke(`${prefix}org`, activeId, "2026-08-11T12:00:00Z")

    await admin`update deployment_control_state set lease_expires_at = '2026-08-11T01:00:00Z' where singleton = 1`
    const grace = await decide(graceId, "grace")
    expect(grace.allowed).toBe(true)
    await revoke(`${prefix}org`, graceId, "2026-08-11T12:00:00Z")

    await admin`update deployment_control_state set subscription_status = 'suspended' where singleton = 1`
    const readOnly = await decide(readOnlyId, "read-only")
    expect(readOnly.allowed).toBe(false)
    expect(readOnly.reason).toBe("read_only")

    await admin`update deployment_control_state set
      deployment_id = null, current_revision = 0, canonical_envelope = null, canonical_payload = null,
      envelope_digest = null, key_id = null, signature = null, issued_at = null, lease_expires_at = null,
      contract_starts_at = null, contract_ends_at = null, grace_until = null, subscription_status = null,
      seat_limit = null, module_ids = null, greatest_trusted_at = null, accepted_at = null
      where singleton = 1`
    const unknown = await decide(unknownId, "unknown")
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
    expect((await reserve(
      `${prefix}org`, "00000000-0000-4000-8000-000000000051", `${prefix}new@example.com`, "2026-08-11",
    )).allowed).toBe(false)

    expect((await app`select * from change_deployment_membership(
      ${`${prefix}org`}, ${`${prefix}over-member-b`}, false, null, null, '2026-08-11'
    )`)[0].allowed).toBe(true)
    const reactivation = (await app`select * from activate_deployment_membership(
      ${`${prefix}org`}, ${`${prefix}over-b`}, ${`${prefix}over-member-b`}, null, 0,
      null, null, null, false, '2026-08-11'
    )`)[0]
    expect(reactivation.allowed).toBe(false)
    expect(reactivation.reason).toBe("seat_limit")
  })

  it("makes an empty-tenant bootstrap retry idempotent without duplicate audit", async () => {
    const userId = `${prefix}bootstrap-user`
    const memberId = `${prefix}bootstrap-member`
    await admin`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, 'Bootstrap', ${`${prefix}bootstrap@example.com`}, true, now(), now())`

    const first = (await app`select * from activate_deployment_membership(
      ${`${prefix}org`}, ${userId}, ${memberId}, null, 100,
      null, ${userId}, null, true, '2026-08-11'
    )`)[0]
    const retry = (await app`select * from activate_deployment_membership(
      ${`${prefix}org`}, ${userId}, ${memberId}, null, 100,
      null, ${userId}, null, true, '2026-08-11'
    )`)[0]
    const genericRetry = (await app`select * from activate_deployment_membership(
      ${`${prefix}org`}, ${userId}, ${memberId}, null, 100,
      null, ${userId}, null, false, '2026-08-11'
    )`)[0]

    expect(first.reason).toBe("allowed")
    expect(retry.reason).toBe("idempotent")
    expect(genericRetry.reason).toBe("idempotent")
    expect(await admin`select id from member where id = ${memberId}`).toHaveLength(1)
    expect(await admin`select id from audit_log where action = 'member.added' and entity_id = ${memberId}`).toHaveLength(1)
  })

  it("rejects vendor-support standing membership and direct crm_app seat bypasses", async () => {
    await admin`insert into "user" (id, name, email, email_verified, is_vendor_support, created_at, updated_at)
      values (${`${prefix}vendor`}, 'Vendor', ${`${prefix}vendor@example.com`}, true, true, now(), now())`
    const memberId = `${prefix}vendor-member`
    const decision = (await app`select * from activate_deployment_membership(
      ${`${prefix}org`}, ${`${prefix}vendor`}, ${memberId}, null, 0, null, null, null, false, '2026-08-11'
    )`)[0]
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("vendor_support_no_membership")
    await admin`insert into member (id, organization_id, user_id, role, created_at)
      values (${memberId}, ${`${prefix}org`}, ${`${prefix}vendor`}, 'member', now())`
    await expect(app.begin(async (tx) => {
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at)
        values (${memberId}, ${`${prefix}org`}, 'active', 0, now(), now())`
    })).rejects.toThrow(/permission denied/)
  })

  it("revokes raw seat DML and member/profile identity reassignment from crm_app", async () => {
    const [privileges] = await admin`
      select
        has_table_privilege('crm_app', 'member', 'INSERT') as member_insert,
        has_table_privilege('crm_app', 'member', 'DELETE') as member_delete,
        has_table_privilege('crm_app', 'pending_invites', 'INSERT') as invite_insert,
        has_table_privilege('crm_app', 'membership_profiles', 'INSERT') as profile_insert,
        has_column_privilege('crm_app', 'membership_profiles', 'member_id', 'UPDATE') as profile_reassign,
        has_column_privilege('crm_app', 'membership_profiles', 'status', 'UPDATE') as status_update,
        has_function_privilege('crm_app', 'reserve_deployment_seat(text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE') as raw_decision_execute,
        has_function_privilege('crm_app', 'reserve_deployment_invitation(uuid,text,text,uuid,integer,text,text,text,timestamp with time zone,timestamp with time zone)', 'EXECUTE') as authority_execute
    `
    expect(privileges).toEqual({
      member_insert: false,
      member_delete: false,
      invite_insert: false,
      profile_insert: false,
      profile_reassign: false,
      status_update: false,
      raw_decision_execute: false,
      authority_execute: true,
    })
    await expect(app`select set_config('app.deployment_seat_member_id', 'forged', true)`).resolves.toBeDefined()
    await expect(app`insert into member (id, organization_id, user_id, role, created_at)
      values ('forged', ${`${prefix}org`}, 'missing', 'member', now())`).rejects.toThrow(/permission denied/)
    await admin`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${`${prefix}raw-user`}, 'Raw', ${`${prefix}raw@example.com`}, true, now(), now())`
    await admin`insert into member (id, organization_id, user_id, role, created_at)
      values (${`${prefix}raw-member`}, ${`${prefix}org`}, ${`${prefix}raw-user`}, 'member', now())`
    await admin`insert into membership_profiles (member_id, tenant_id, status, tier_level, created_at, updated_at)
      values (${`${prefix}raw-member`}, ${`${prefix}org`}, 'disabled', 0, now(), now())`
    await expect(app.begin(async (tx) => {
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`update membership_profiles set member_id = 'forged' where member_id = ${`${prefix}raw-member`}`
    })).rejects.toThrow(/permission denied/)
    await expect(app.begin(async (tx) => {
      await tx`select set_config('app.current_tenant', ${`${prefix}org`}, true)`
      await tx`insert into pending_invites (
        id, tenant_id, email, normalized_email, expires_at, tier_level, created_at, updated_at
      ) values (
        '00000000-0000-4000-8000-000000000099', ${`${prefix}org`}, ${`${prefix}raw-invite@example.com`},
        ${`${prefix}raw-invite@example.com`}, now() + interval '1 day', 0, now(), now()
      )`
    })).rejects.toThrow(/permission denied/)
  })

  it("keeps the last-owner guard inside the database-authoritative membership seam", async () => {
    const ownerRoleId = "20000000-0000-4000-8000-000000000001"
    await admin`insert into roles (id, tenant_id, name, is_system, default_tier_level, created_at, updated_at)
      values (${ownerRoleId}::uuid, ${`${prefix}org`}, 'Owner', true, 100, now(), now())`
    await admin`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${`${prefix}owner`}, 'Owner', ${`${prefix}owner@example.com`}, true, now(), now())`
    await admin`insert into member (id, organization_id, user_id, role, created_at)
      values (${`${prefix}owner-member`}, ${`${prefix}org`}, ${`${prefix}owner`}, 'member', now())`
    await admin`insert into membership_profiles (
      member_id, tenant_id, role_id, status, tier_level, created_at, updated_at
    ) values (${`${prefix}owner-member`}, ${`${prefix}org`}, ${ownerRoleId}::uuid, 'active', 100, now(), now())`
    await expect(app`select * from change_deployment_membership(
      ${`${prefix}org`}, ${`${prefix}owner-member`}, false, null, null, '2026-08-11'
    )`).rejects.toThrow(/last Owner/)
  })

  it("reconciles expired invitations idempotently and status ignores expiry without the job", async () => {
    const invitationId = "00000000-0000-4000-8000-000000000031"
    const email = `${prefix}expiry@example.com`
    expect((await reserve(`${prefix}org`, invitationId, email, "2026-08-09", "2026-08-10")).allowed).toBe(true)
    await admin`update deployment_seat_state set last_reconciled_at = '1970-01-01' where singleton = 1`
    expect(Number((await app`select * from read_deployment_status_rollup()`)[0].reserved_invitation_count)).toBe(0)
    expect(await admin`select id from pending_invites where id = ${invitationId}::uuid`).toHaveLength(0)
    const audits = await admin`select id from audit_log where action = 'member.invite_expired' and entity_id = ${invitationId}`
    expect(audits).toHaveLength(1)
    expect(Number((await app`select * from reconcile_expired_deployment_seat_reservations('2026-08-13')`)[0].expired_count)).toBe(0)
  })

  it("bounds heartbeat-triggered expiry cleanup to 500 invitations per pass", async () => {
    await admin`
      insert into pending_invites (id, tenant_id, email, normalized_email, expires_at, tier_level, created_at, updated_at)
      select
        ('10000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
        ${`${prefix}org`},
        ${prefix} || 'bounded-' || gs || '@example.com',
        ${prefix} || 'bounded-' || gs || '@example.com',
        '2026-08-10', 0, '2026-08-09', '2026-08-09'
      from generate_series(1, 501) gs
    `
    await admin`
      insert into deployment_seat_reservations (invitation_id, normalized_email, status, expires_at, created_at, updated_at)
      select id::text, normalized_email, 'reserved', expires_at, created_at, updated_at
      from pending_invites where email like ${`${prefix}bounded-%`}
    `
    await admin`update deployment_seat_state set last_reconciled_at = '1970-01-01' where singleton = 1`
    await app`select * from read_deployment_status_rollup()`
    expect(await admin`select id from pending_invites where email like ${`${prefix}bounded-%`}`).toHaveLength(1)
    expect(await admin`select id from audit_log where action = 'member.invite_expired' and entity_id like '10000000-0000-4000-8000-%'`).toHaveLength(500)
  })
})
