import "dotenv/config"
import { readFileSync } from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"

/**
 * Runs as the privileged (superuser) role. Applies Drizzle migrations, then the
 * hand-authored RLS policies and report-only views. Idempotent.
 */
async function main() {
  const url =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/crm"

  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql)

  console.log("→ applying drizzle migrations…")
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") })

  console.log("→ applying RLS policies…")
  await sql.unsafe(readFileSync(path.join(process.cwd(), "db/sql/rls.sql"), "utf8"))

  console.log("→ applying report views…")
  await sql.unsafe(readFileSync(path.join(process.cwd(), "db/sql/views.sql"), "utf8"))

  // Keep the crm_app role password in sync with the app's DATABASE_URL.
  const appPassword = process.env.CRM_APP_PASSWORD
  if (appPassword) {
    console.log("→ setting crm_app password…")
    await sql`ALTER ROLE crm_app WITH LOGIN PASSWORD ${sql.unsafe(`'${appPassword.replace(/'/g, "''")}'`)}`
  }

  await sql.end()
  console.log("✓ migrate complete")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
