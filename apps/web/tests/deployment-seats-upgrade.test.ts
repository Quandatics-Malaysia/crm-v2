import { createHash, randomBytes } from "node:crypto"
import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migrate } from "drizzle-orm/postgres-js/migrator"

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
const required = process.env.REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS === "1"
const integration = adminUrl ? describe.sequential : required ? describe.sequential : describe.skip
const original0068Sha256 = "90fceb113263a35756b3ca16f62220f86c199ccd9b8898c45dc651044c1851d1"

integration("deployment seat forward migration", () => {
  const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
  let server: ReturnType<typeof postgres>
  let databaseName: string
  let databaseUrl: string
  let phaseOneFolder: string

  beforeAll(async () => {
    if (!adminUrl) throw new Error("Seat upgrade tests require TEST_DATABASE_ADMIN_URL")
    const serverUrl = new URL(adminUrl)
    serverUrl.pathname = "/postgres"
    server = postgres(serverUrl.toString(), { max: 1 })
    databaseName = `crm_task4_upgrade_${process.pid}_${randomBytes(4).toString("hex")}`
    await server.unsafe(`CREATE DATABASE "${databaseName}"`)
    const targetUrl = new URL(adminUrl)
    targetUrl.pathname = `/${databaseName}`
    databaseUrl = targetUrl.toString()
    phaseOneFolder = await mkdtemp(path.join(tmpdir(), "crm-task4-upgrade-"))
    await cp(migrationsFolder, phaseOneFolder, { recursive: true })

    const journalPath = path.join(phaseOneFolder, "meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>
    }
    journal.entries = journal.entries.filter((entry) => entry.idx <= 69)
    await writeFile(journalPath, `${JSON.stringify(journal, null, "\t")}\n`)
    for (const name of await readdir(phaseOneFolder)) {
      if (/^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) > 69) {
        await unlink(path.join(phaseOneFolder, name))
      }
    }
  }, 30_000)

  afterAll(async () => {
    if (databaseName && server) await server.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    if (server) await server.end()
    if (phaseOneFolder) await rm(phaseOneFolder, { recursive: true, force: true })
  }, 30_000)

  it("keeps the journaled 0068 bytes immutable and appends 0070", async () => {
    const migration0068 = await readFile(path.join(migrationsFolder, "0068_deployment_seats.sql"))
    expect(createHash("sha256").update(migration0068).digest("hex")).toBe(original0068Sha256)
    const journal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.at(-1)).toMatchObject({ idx: 70, tag: "0070_organization_archive" })
  })

  it("upgrades a database applied through 0069, then applies current RLS", async () => {
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await migrate(drizzle(sql), { migrationsFolder: phaseOneFolder })
      expect((await sql`select migration_version from deployment_runtime_metadata where singleton = 1`)[0].migration_version).toBe("0069")

      await migrate(drizzle(sql), { migrationsFolder })
      await sql.unsafe(await readFile(path.resolve(process.cwd(), "db/sql/rls.sql"), "utf8"))
      expect((await sql`select migration_version from deployment_runtime_metadata where singleton = 1`)[0].migration_version).toBe("0070")
      expect(await sql`select last_reconciled_at from deployment_seat_state where singleton = 1`).toHaveLength(1)
      expect((await sql`select status, archived_at from organization limit 0`).columns.map((column) => column.name)).toEqual([
        "status",
        "archived_at",
      ])
    } finally {
      await sql.end()
    }
  }, 30_000)
})
