import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import postgres, { type Sql } from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Tx } from "@/db"
import * as schema from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"
import {
  recordPpvvcSyncChanges,
  updateFunnelPpvvc,
  updateOpportunityPpvvc,
} from "@/server/services/ppvvc"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const appUrl = process.env.TEST_DATABASE_URL
const required = process.env.REQUIRE_PPVVC_DB_TESTS === "1"
const integration = adminUrl && appUrl ? describe.sequential : required ? describe.sequential : describe.skip
const prefix = "task5-ppvvc-"

type Fixture = {
  tenantId: string
  otherTenantId: string
  userId: string
  memberId: string
  opportunityId: string
  otherOpportunityId: string
  liveFunnelId: string
  deletedFunnelId: string
}

const updated = {
  pain: "Updated pain",
  power: "Updated power",
  vision: "Updated vision",
  value: "Updated value",
  control: "Updated control",
}

integration("PPVVC PostgreSQL boundary", () => {
  let admin: Sql
  let appA: Sql
  let appB: Sql
  const tenants: string[] = []

  beforeAll(() => {
    if (!adminUrl || !appUrl) {
      throw new Error("PPVVC PostgreSQL tests require TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL")
    }
    admin = postgres(adminUrl, { max: 2 })
    appA = postgres(appUrl, { max: 2 })
    appB = postgres(appUrl, { max: 2 })
  })

  afterAll(async () => {
    if (!admin) return
    for (const tenantId of tenants) {
      await admin`delete from organization where id = ${tenantId}`
    }
    await admin`delete from "user" where id like ${`${prefix}%`}`
    await Promise.all([admin.end(), appA.end(), appB.end()])
  })

  async function scoped<T>(client: Sql, tenantId: string, work: (tx: Tx) => Promise<T>) {
    const database = drizzle(client, { schema })
    return database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`)
      return work(tx as unknown as Tx)
    })
  }

  async function fixture(): Promise<Fixture> {
    const token = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
    const tenantId = `${prefix}tenant-${token}`
    const otherTenantId = `${prefix}other-${token}`
    const userId = `${prefix}user-${token}`
    const memberId = `${prefix}member-${token}`
    const otherUserId = `${prefix}other-user-${token}`
    const otherMemberId = `${prefix}other-member-${token}`
    const accountId = crypto.randomUUID()
    const otherAccountId = crypto.randomUUID()
    const pipelineId = crypto.randomUUID()
    const otherPipelineId = crypto.randomUUID()
    const stageId = crypto.randomUUID()
    const otherStageId = crypto.randomUUID()
    const opportunityId = crypto.randomUUID()
    const otherOpportunityId = crypto.randomUUID()
    const liveFunnelId = crypto.randomUUID()
    const deletedFunnelId = crypto.randomUUID()
    tenants.push(tenantId, otherTenantId)

    await admin`
      insert into organization (id, name, slug, created_at)
      values (${tenantId}, 'Task 5', ${tenantId}, now()), (${otherTenantId}, 'Task 5 Other', ${otherTenantId}, now())
    `
    await admin`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values
        (${userId}, 'Task 5 Actor', ${`${userId}@example.com`}, true, now(), now()),
        (${otherUserId}, 'Task 5 Other Actor', ${`${otherUserId}@example.com`}, true, now(), now())
    `
    await admin`
      insert into member (id, organization_id, user_id, role, created_at)
      values
        (${memberId}, ${tenantId}, ${userId}, 'member', now()),
        (${otherMemberId}, ${otherTenantId}, ${otherUserId}, 'member', now())
    `
    await admin`
      insert into accounts (id, tenant_id, name, currency, created_at, updated_at)
      values
        (${accountId}::uuid, ${tenantId}, 'Task 5 Account', 'MYR', now(), now()),
        (${otherAccountId}::uuid, ${otherTenantId}, 'Task 5 Other Account', 'MYR', now(), now())
    `
    await admin`
      insert into pipelines (id, tenant_id, name, is_default, created_at, updated_at)
      values
        (${pipelineId}::uuid, ${tenantId}, 'Task 5 Pipeline', true, now(), now()),
        (${otherPipelineId}::uuid, ${otherTenantId}, 'Task 5 Other Pipeline', true, now(), now())
    `
    await admin`
      insert into pipeline_stages (id, tenant_id, pipeline_id, code, name, probability, kind, sort_order, required_fields, created_at, updated_at)
      values
        (${stageId}::uuid, ${tenantId}, ${pipelineId}::uuid, '0e', 'Open', 0, 'OPEN', 1, '[]'::jsonb, now(), now()),
        (${otherStageId}::uuid, ${otherTenantId}, ${otherPipelineId}::uuid, '0e', 'Other Open', 0, 'OPEN', 1, '[]'::jsonb, now(), now())
    `
    await admin`
      insert into opportunities (
        id, tenant_id, account_id, owner_member_id, opportunity_year, opportunity_number,
        code, name, pain, power, vision, value, control, currency, created_at, updated_at
      ) values
        (${opportunityId}::uuid, ${tenantId}, ${accountId}::uuid, ${memberId}, 2026, 1,
         ${`${prefix}opp-${token}`}, 'Task 5 Opportunity', 'Old pain', 'Old power', 'Old vision', 'Old value', 'Old control', 'MYR', now(), now()),
        (${otherOpportunityId}::uuid, ${otherTenantId}, ${otherAccountId}::uuid, ${otherMemberId}, 2026, 1,
         ${`${prefix}other-opp-${token}`}, 'Task 5 Other Opportunity', 'Other pain', null, null, null, null, 'MYR', now(), now())
    `
    await admin`
      insert into funnels (
        id, tenant_id, opportunity_id, name, account_id, pipeline_id, current_stage_id,
        owner_member_id, pain, power, vision, value, control, currency, created_at, updated_at, deleted_at
      ) values
        (${liveFunnelId}::uuid, ${tenantId}, ${opportunityId}::uuid, 'Task 5 Live Funnel', ${accountId}::uuid,
         ${pipelineId}::uuid, ${stageId}::uuid, ${memberId}, 'Old pain', 'Old power', 'Old vision', 'Old value', 'Old control', 'MYR', now(), now(), null),
        (${deletedFunnelId}::uuid, ${tenantId}, ${opportunityId}::uuid, 'Task 5 Deleted Funnel', ${accountId}::uuid,
         ${pipelineId}::uuid, ${stageId}::uuid, ${memberId}, 'Deleted pain', null, null, null, null, 'MYR', now(), now(), now())
    `

    return {
      tenantId,
      otherTenantId,
      userId,
      memberId,
      opportunityId,
      otherOpportunityId,
      liveFunnelId,
      deletedFunnelId,
    }
  }

  function context(f: Fixture): ServerContext {
    return {
      userId: f.userId,
      userName: "Task 5 Actor",
      userEmail: `${f.userId}@example.com`,
      isSuperadmin: false,
      tenantId: f.tenantId,
      memberId: f.memberId,
      tierLevel: 0,
      roleName: "member",
      status: "active",
      tenantSuspended: false,
      subscriptionInactive: false,
      permissions: new Set(),
      can: () => true,
    }
  }

  it("enforces tenant/deleted predicates and writes meaningful source and child history", async () => {
    const f = await fixture()
    const sync = await scoped(appA, f.tenantId, (tx) =>
      updateOpportunityPpvvc(tx, {
        opportunityId: f.opportunityId,
        tenantId: f.tenantId,
        values: updated,
        actorId: f.userId,
      })
    )
    expect(sync.updatedChildIds).toEqual([f.liveFunnelId])
    expect(sync.updatedChildren).toHaveLength(1)

    await scoped(appA, f.tenantId, (tx) => recordPpvvcSyncChanges(tx, context(f), sync))
    await expect(
      scoped(appA, f.tenantId, (tx) =>
        updateOpportunityPpvvc(tx, {
          opportunityId: f.otherOpportunityId,
          tenantId: f.tenantId,
          values: updated,
          actorId: f.userId,
        })
      )
    ).rejects.toThrow("Opportunity not found")

    const rows = await admin`
      select id, tenant_id, pain, power, vision, value, control, deleted_at
      from funnels where id = ${f.liveFunnelId}::uuid or id = ${f.deletedFunnelId}::uuid
      order by id
    `
    const live = rows.find((row) => row.id === f.liveFunnelId)
    const deleted = rows.find((row) => row.id === f.deletedFunnelId)
    expect(live).toMatchObject({ tenant_id: f.tenantId, ...updated, deleted_at: null })
    expect(deleted).toMatchObject({ tenant_id: f.tenantId, pain: "Deleted pain" })

    const audits = await admin`
      select entity_type, entity_id, before, after
      from audit_log where tenant_id = ${f.tenantId} and action in ('opportunity.updated', 'funnel.updated')
      order by entity_id
    `
    expect(audits).toHaveLength(2)
    expect(
      audits.every((row) => JSON.stringify(row.before) !== JSON.stringify(row.after))
    ).toBe(true)
    const activities = await admin`
      select entity_id, changes from activities
      where tenant_id = ${f.tenantId} and type = 'update'
      order by entity_id
    `
    expect(activities).toHaveLength(2)
    expect(activities.every((row) => JSON.stringify(row.changes).includes("Pain"))).toBe(true)
  })

  it("rolls back source, snapshots, and audit history atomically", async () => {
    const f = await fixture()
    await expect(
      scoped(appA, f.tenantId, async (tx) => {
        const sync = await updateFunnelPpvvc(tx, {
          funnelId: f.liveFunnelId,
          tenantId: f.tenantId,
          values: updated,
          actorId: f.userId,
        })
        await recordPpvvcSyncChanges(tx, context(f), sync)
        throw new Error("rollback PPVVC")
      })
    ).rejects.toThrow("rollback PPVVC")

    const [source] = await admin`select pain, power, vision, value, control from opportunities where id = ${f.opportunityId}::uuid`
    const [child] = await admin`select pain, power, vision, value, control from funnels where id = ${f.liveFunnelId}::uuid`
    expect(source).toMatchObject({ pain: "Old pain", power: "Old power" })
    expect(child).toMatchObject({ pain: "Old pain", power: "Old power" })
    expect(await admin`select id from audit_log where tenant_id = ${f.tenantId}`).toHaveLength(0)
    expect(await admin`select id from activities where tenant_id = ${f.tenantId}`).toHaveLength(0)
  })

  it("serializes concurrent source updates so every live snapshot matches the committed source", async () => {
    const f = await fixture()
    let first!: Promise<unknown>
    const firstReady = new Promise<void>((resolve) => {
      first = scoped(appA, f.tenantId, async (tx) => {
        await updateOpportunityPpvvc(tx, {
          opportunityId: f.opportunityId,
          tenantId: f.tenantId,
          values: { pain: "First writer" },
          actorId: f.userId,
        })
        resolve()
        await new Promise<void>((release) => setTimeout(release, 120))
      })
    })
    await firstReady
    const second = scoped(appB, f.tenantId, (tx) =>
      updateOpportunityPpvvc(tx, {
        opportunityId: f.opportunityId,
        tenantId: f.tenantId,
        values: { power: "Second writer" },
        actorId: f.userId,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    let secondFinished = false
    void second.then(() => {
      secondFinished = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(secondFinished).toBe(false)
    await first
    await second
    const [finalSource] = await admin`select pain, power from opportunities where id = ${f.opportunityId}::uuid`
    const [finalChild] = await admin`select pain, power from funnels where id = ${f.liveFunnelId}::uuid`
    expect(finalChild).toMatchObject(finalSource)
  })

  it("serializes Funnel and Opportunity entry points without deadlock or lost fields", async () => {
    const f = await fixture()
    const funnelWrite = scoped(appA, f.tenantId, (tx) =>
      updateFunnelPpvvc(tx, {
        funnelId: f.liveFunnelId,
        tenantId: f.tenantId,
        values: { pain: "Funnel writer" },
        actorId: f.userId,
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
    const opportunityWrite = scoped(appB, f.tenantId, (tx) =>
      updateOpportunityPpvvc(tx, {
        opportunityId: f.opportunityId,
        tenantId: f.tenantId,
        values: { power: "Opportunity writer" },
        actorId: f.userId,
      })
    )

    await Promise.race([
      Promise.all([funnelWrite, opportunityWrite]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("cross-entry PPVVC update timed out")), 3_000)
      ),
    ])

    const [finalSource] = await admin`
      select pain, power from opportunities where id = ${f.opportunityId}::uuid
    `
    const [finalChild] = await admin`
      select pain, power from funnels where id = ${f.liveFunnelId}::uuid
    `
    expect(finalSource).toMatchObject({ pain: "Funnel writer", power: "Opportunity writer" })
    expect(finalChild).toMatchObject(finalSource)
  })
})
