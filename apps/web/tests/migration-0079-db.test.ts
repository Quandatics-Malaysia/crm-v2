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

integration("product taxonomy migration PostgreSQL fixture", () => {
  const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
  let server: ReturnType<typeof postgres>
  let databaseName: string
  let databaseUrl: string
  let pre0079Folder: string

  beforeAll(async () => {
    if (!adminUrl) throw new Error("Migration fixture tests require TEST_DATABASE_ADMIN_URL")
    const serverUrl = new URL(adminUrl)
    serverUrl.pathname = "/postgres"
    server = postgres(serverUrl.toString(), { max: 1 })
    databaseName = `crm_task7_0079_${process.pid}_${randomBytes(4).toString("hex")}`
    await server.unsafe(`CREATE DATABASE "${databaseName}"`)

    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${databaseName}`
    databaseUrl = targetUrl.toString()
    pre0079Folder = await mkdtemp(path.join(tmpdir(), "crm-task7-0079-"))
    await cp(migrationsFolder, pre0079Folder, { recursive: true })

    const journalPath = path.join(pre0079Folder, "meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>
    }
    journal.entries = journal.entries.filter((entry) => entry.idx < 79)
    await writeFile(journalPath, `${JSON.stringify(journal, null, "\t")}\n`)
    for (const name of await readdir(pre0079Folder)) {
      if (/^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) >= 79) {
        await unlink(path.join(pre0079Folder, name))
      }
    }

    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await migrate(drizzle(sql), { migrationsFolder: pre0079Folder })
      await sql`
        INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('task7-tenant', 'Task 7 Tenant', 'task7-tenant')
      `
      await sql`
        INSERT INTO "tenant_settings" ("organization_id", "product_codes")
        VALUES (
          'task7-tenant',
          '[{"code":"PS","name":"Professional Services"}]'::jsonb
        )
      `
      await sql`
        INSERT INTO "products" (
          "tenant_id", "name", "product_code", "subcategory", "currency", "standard_price"
        ) VALUES
          ('task7-tenant', 'Advisory', 'PS', 'Advisory', 'MYR', '10.00'),
          ('task7-tenant', 'Analytics', 'PS', 'Data Analytics', 'MYR', '20.00')
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
    if (pre0079Folder) await rm(pre0079Folder, { recursive: true, force: true })
  }, 30_000)

  it("preserves category/subcategory labels and stores stable generated codes", async () => {
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await migrate(drizzle(sql), { migrationsFolder })
      const settings = await sql<{ product_codes: unknown }[]>`
        SELECT product_codes FROM tenant_settings WHERE organization_id = 'task7-tenant'
      `
      const products = await sql<{ subcategory: string }[]>`
        SELECT subcategory FROM products WHERE tenant_id = 'task7-tenant' ORDER BY name
      `
      expect(settings[0]?.product_codes).toEqual([
        {
          code: "PS",
          name: "Professional Services",
          subcategories: [
            { code: "ADVISORY", name: "Advisory" },
            { code: "DATA_ANALYTICS", name: "Data Analytics" },
          ],
        },
      ])
      expect(products).toEqual([
        { subcategory: "ADVISORY" },
        { subcategory: "DATA_ANALYTICS" },
      ])
    } finally {
      await sql.end()
    }
  }, 30_000)
})
