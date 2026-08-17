import { randomBytes, randomUUID } from "node:crypto"
import postgres, { type Sql } from "postgres"
import { sql as query } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Tx } from "@/db"
import { nextQuoteNumber } from "@/server/services/numbering"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const required = process.env.REQUIRE_QUOTATION_DB_TESTS === "1"
const integration = adminUrl ? describe.sequential : required ? describe.sequential : describe.skip

integration("quotation numbering PostgreSQL boundary", () => {
  let server: Sql
  let sql: Sql
  let databaseName: string
  let db: ReturnType<typeof drizzle>
  const tenantId = `task10-numbering-${process.pid}-${randomBytes(4).toString("hex")}`
  const funnelId = randomUUID()

  beforeAll(async () => {
    if (!adminUrl) throw new Error("Quotation numbering tests require TEST_DATABASE_ADMIN_URL")
    const serverUrl = new URL(adminUrl)
    serverUrl.pathname = "/postgres"
    server = postgres(serverUrl.toString(), { max: 1 })
    databaseName = `crm_task10_numbering_${process.pid}_${randomBytes(4).toString("hex")}`
    await server.unsafe(`CREATE DATABASE "${databaseName}"`)

    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${databaseName}`
    sql = postgres(targetUrl.toString(), { max: 4 })
    db = drizzle(sql)
    await sql.unsafe(`
      CREATE TABLE "funnels" (
        "id" uuid PRIMARY KEY,
        "quote_running_number" integer,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now()
      );
      CREATE TABLE "tenant_settings" (
        "organization_id" text PRIMARY KEY,
        "quote_next_number" integer NOT NULL,
        "quote_pad_width" integer
      );
      CREATE TABLE "quotations" (
        "id" uuid PRIMARY KEY,
        "funnel_id" uuid NOT NULL,
        "quote_number" text NOT NULL UNIQUE,
        "version" integer NOT NULL,
        "created_at" timestamp with time zone NOT NULL
      )
    `)
    await sql`INSERT INTO "funnels" ("id") VALUES (${funnelId})`
    await sql`
      INSERT INTO "tenant_settings" ("organization_id", "quote_next_number", "quote_pad_width")
      VALUES (${tenantId}, 100, 4)
    `
  }, 30_000)

  afterAll(async () => {
    await sql?.end()
    if (databaseName && server) {
      await server.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    }
    await server?.end()
  }, 30_000)

  it("allocates distinct versions and quote numbers under transaction contention", async () => {
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstAllocated!: () => void
    const firstAllocatedPromise = new Promise<void>((resolve) => {
      firstAllocated = resolve
    })

    const ctx = { tenantId } as Parameters<typeof nextQuoteNumber>[1]
    const first = db.transaction(async (tx) => {
      const allocation = await nextQuoteNumber(tx as unknown as Tx, ctx, funnelId)
      firstAllocated()
      await tx.execute(query`INSERT INTO "quotations" ("id", "funnel_id", "quote_number", "version", "created_at") VALUES (${randomUUID()}, ${funnelId}, ${allocation.quoteNumber}, ${allocation.version}, now())`)
      await firstHeld
      return allocation
    })
    await firstAllocatedPromise

    const second = db.transaction(async (tx) => {
      const allocation = await nextQuoteNumber(tx as unknown as Tx, ctx, funnelId)
      await tx.execute(query`INSERT INTO "quotations" ("id", "funnel_id", "quote_number", "version", "created_at") VALUES (${randomUUID()}, ${funnelId}, ${allocation.quoteNumber}, ${allocation.version}, now())`)
      return allocation
    })
    const secondFinishedBeforeCommit = await Promise.race([
      second.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 100)),
    ])
    expect(secondFinishedBeforeCommit).toBe(false)

    releaseFirst()
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.version).toBe(1)
    expect(secondResult.version).toBe(2)
    expect(firstResult.quoteNumber).not.toBe(secondResult.quoteNumber)

    const rows = await sql`
      SELECT "quote_number", "version"
      FROM "quotations"
      WHERE "funnel_id" = ${funnelId}
      ORDER BY "version"
    `
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.version)).toEqual([1, 2])
    expect(new Set(rows.map((row) => row.quote_number)).size).toBe(2)
    expect(await sql`SELECT "quote_running_number", "quote_next_number" FROM "funnels" CROSS JOIN "tenant_settings" WHERE "funnels"."id" = ${funnelId} AND "tenant_settings"."organization_id" = ${tenantId}`)
      .toEqual([{ quote_running_number: 100, quote_next_number: 101 }])
  }, 30_000)
})
