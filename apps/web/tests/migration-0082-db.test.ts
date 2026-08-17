import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const required = process.env.REQUIRE_MIGRATION_DB_TESTS === "1"
const integration = adminUrl ? describe.sequential : required ? describe.sequential : describe.skip

integration("quotation revision migration PostgreSQL boundary", () => {
  let server: ReturnType<typeof postgres>
  let databaseName: string
  let databaseUrl: string
  let statements: string[]

  beforeAll(async () => {
    if (!adminUrl) throw new Error("Quotation migration tests require TEST_DATABASE_ADMIN_URL")

    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0082_quotation_revisions.sql"),
      "utf8"
    )
    statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)

    const serverUrl = new URL(adminUrl)
    serverUrl.pathname = "/postgres"
    server = postgres(serverUrl.toString(), { max: 1 })
    databaseName = `crm_task10_0082_${process.pid}_${randomBytes(4).toString("hex")}`
    await server.unsafe(`CREATE DATABASE "${databaseName}"`)

    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${databaseName}`
    databaseUrl = targetUrl.toString()

    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql.unsafe(`
        CREATE TABLE "quotations" (
          "id" uuid PRIMARY KEY,
          "funnel_id" uuid NOT NULL,
          "quote_number" text NOT NULL,
          "version" integer NOT NULL,
          "created_at" timestamp with time zone NOT NULL
        )
      `)
      await sql`
        INSERT INTO "quotations" ("id", "funnel_id", "quote_number", "version", "created_at")
        VALUES
          ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Q-KEEP-1', 1, '2026-01-01T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Q-KEEP-2', 1, '2026-01-02T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'Q-KEEP-3', 2, '2026-01-03T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'Q-KEEP-4', 2, '2026-01-04T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000002', 'Q-OTHER-1', 1, '2026-02-01T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000002', 'Q-OTHER-2', 1, '2026-02-02T00:00:00Z')
      `
    } finally {
      await sql.end()
    }
  }, 30_000)

  afterAll(async () => {
    if (databaseName && server) {
      await server.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    }
    await server?.end()
  }, 30_000)

  it("deterministically repairs duplicate versions, preserves data, and is idempotent", async () => {
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      for (const statement of statements) await sql.unsafe(statement)

      const afterFirstRun = await sql`
        SELECT "id", "funnel_id", "quote_number", "version", "created_at"
        FROM "quotations"
        ORDER BY "id"
      `
      const uniqueVersions = await sql`
        SELECT "funnel_id", count(*) AS total, count(DISTINCT "version") AS distinct_total
        FROM "quotations"
        GROUP BY "funnel_id"
        ORDER BY "funnel_id"
      `

      for (const statement of statements) await sql.unsafe(statement)
      const afterSecondRun = await sql`
        SELECT "id", "funnel_id", "quote_number", "version", "created_at"
        FROM "quotations"
        ORDER BY "id"
      `

      expect(afterFirstRun).toEqual([
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000101", quote_number: "Q-KEEP-1", version: 1 }),
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000102", quote_number: "Q-KEEP-2", version: 3 }),
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000103", quote_number: "Q-KEEP-3", version: 2 }),
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000104", quote_number: "Q-KEEP-4", version: 4 }),
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000201", quote_number: "Q-OTHER-1", version: 1 }),
        expect.objectContaining({ id: "00000000-0000-0000-0000-000000000202", quote_number: "Q-OTHER-2", version: 2 }),
      ])
      expect(uniqueVersions).toEqual([
        { funnel_id: "00000000-0000-0000-0000-000000000001", total: 4, distinct_total: 4 },
        { funnel_id: "00000000-0000-0000-0000-000000000002", total: 2, distinct_total: 2 },
      ])
      expect(afterSecondRun).toEqual(afterFirstRun)
    } finally {
      await sql.end()
    }
  }, 30_000)
})
