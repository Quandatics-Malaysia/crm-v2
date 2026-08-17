import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const required = process.env.REQUIRE_MIGRATION_DB_TESTS === "1"
const integration = adminUrl ? describe.sequential : required ? describe.sequential : describe.skip

integration("opportunity name migration PostgreSQL fixture", () => {
  const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
  let server: ReturnType<typeof postgres>
  let databaseName: string
  let databaseUrl: string
  let pre0078Folder: string

  beforeAll(async () => {
    if (!adminUrl) throw new Error("Migration fixture tests require TEST_DATABASE_ADMIN_URL")

    const serverUrl = new URL(adminUrl)
    serverUrl.pathname = "/postgres"
    server = postgres(serverUrl.toString(), { max: 1 })
    databaseName = `crm_task4_0078_${process.pid}_${randomBytes(4).toString("hex")}`
    await server.unsafe(`CREATE DATABASE "${databaseName}"`)

    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${databaseName}`
    databaseUrl = targetUrl.toString()

    pre0078Folder = await mkdtemp(path.join(tmpdir(), "crm-task4-0078-"))
    await cp(migrationsFolder, pre0078Folder, { recursive: true })

    const journalPath = path.join(pre0078Folder, "meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>
    }
    journal.entries = journal.entries.filter((entry) => entry.idx < 78)
    await writeFile(journalPath, `${JSON.stringify(journal, null, "\t")}\n`)

    for (const name of await readdir(pre0078Folder)) {
      if (/^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) >= 78) {
        await unlink(path.join(pre0078Folder, name))
      }
    }

    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await migrate(drizzle(sql), { migrationsFolder: pre0078Folder })
      await sql`
        INSERT INTO "organization" ("id", "name", "slug") VALUES
          ('tenant-a', 'Tenant A', 'tenant-a'),
          ('tenant-b', 'Tenant B', 'tenant-b')
      `
      await sql`
        INSERT INTO "user" ("id", "name", "email") VALUES
          ('user-a', 'Fixture User A', 'fixture-a@example.test'),
          ('user-b', 'Fixture User B', 'fixture-b@example.test')
      `
      await sql`
        INSERT INTO "member" ("id", "organization_id", "user_id") VALUES
          ('member-a', 'tenant-a', 'user-a'),
          ('member-b', 'tenant-b', 'user-b')
      `
      await sql`
        INSERT INTO "accounts" ("id", "tenant_id", "name", "owner_member_id") VALUES
          ('00000000-0000-0000-0000-0000000000a1', 'tenant-a', 'Account A', 'member-a'),
          ('00000000-0000-0000-0000-0000000000b1', 'tenant-b', 'Account B', 'member-b')
      `
      await sql`
        INSERT INTO "opportunities" (
          "id", "tenant_id", "account_id", "owner_member_id", "opportunity_year",
          "opportunity_number", "code", "name", "project_code"
        ) VALUES
          ('00000000-0000-0000-0000-0000000000a2', 'tenant-a', '00000000-0000-0000-0000-0000000000a1', 'member-a', 2026, 7, 'A-CODE-007', 'legacy A', NULL),
          ('00000000-0000-0000-0000-0000000000a3', 'tenant-a', '00000000-0000-0000-0000-0000000000a1', 'member-a', 2025, 12, 'A-CODE-012', 'A-CODE-012', 'A-PROJECT-012'),
          ('00000000-0000-0000-0000-0000000000b2', 'tenant-b', '00000000-0000-0000-0000-0000000000b1', 'member-b', 2026, 7, 'B-CODE-007', 'legacy B', 'B-PROJECT-007')
      `
    } finally {
      await sql.end()
    }
  }, 30_000)

  afterAll(async () => {
    if (databaseName && server) {
      await server.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    }
    if (server) await server.end()
    if (pre0078Folder) await rm(pre0078Folder, { recursive: true, force: true })
  }, 30_000)

  it("backfills names, preserves tenant-scoped identity columns, and is idempotent", async () => {
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      const before = await sql`
        SELECT tenant_id, opportunity_year, opportunity_number, code, name, project_code
        FROM opportunities
        ORDER BY tenant_id, opportunity_number
      `

      await migrate(drizzle(sql), { migrationsFolder })
      const afterFirstRun = await sql`
        SELECT tenant_id, opportunity_year, opportunity_number, code, name, project_code
        FROM opportunities
        ORDER BY tenant_id, opportunity_number
      `
      await migrate(drizzle(sql), { migrationsFolder })
      const afterSecondRun = await sql`
        SELECT tenant_id, opportunity_year, opportunity_number, code, name, project_code
        FROM opportunities
        ORDER BY tenant_id, opportunity_number
      `

      expect(afterFirstRun).toEqual([
        { tenant_id: "tenant-a", opportunity_year: 2026, opportunity_number: 7, code: "A-CODE-007", name: "A-CODE-007", project_code: null },
        { tenant_id: "tenant-a", opportunity_year: 2025, opportunity_number: 12, code: "A-CODE-012", name: "A-CODE-012", project_code: "A-PROJECT-012" },
        { tenant_id: "tenant-b", opportunity_year: 2026, opportunity_number: 7, code: "B-CODE-007", name: "B-CODE-007", project_code: "B-PROJECT-007" },
      ])
      expect(afterSecondRun).toEqual(afterFirstRun)
      expect(afterFirstRun.map(({ tenant_id, opportunity_year, opportunity_number, code, project_code }) => ({
        tenant_id,
        opportunity_year,
        opportunity_number,
        code,
        project_code,
      }))).toEqual(before.map(({ tenant_id, opportunity_year, opportunity_number, code, project_code }) => ({
        tenant_id,
        opportunity_year,
        opportunity_number,
        code,
        project_code,
      })))
    } finally {
      await sql.end()
    }
  }, 30_000)
})
