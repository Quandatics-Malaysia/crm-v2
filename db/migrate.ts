import "dotenv/config"
import { readFileSync } from "node:fs"
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { ALL_PERMISSION_KEYS } from "@/lib/permissions"

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

  // Permission sync. Roles materialize their permissions into role_permissions
  // rows at tenant-creation time, so a permission ADDED later (e.g. the Products
  // module) never reaches entities that were seeded before it existed. Reconcile
  // on every deploy: (1) ensure every code-defined permission exists in the
  // global catalog, (2) grant every catalogued permission to the full-access
  // system roles (Owner/Admin, which are "*") across all tenants. Idempotent.
  console.log("→ syncing permission catalog + full-access grants…")
  await sql`
    INSERT INTO permissions (key)
    SELECT unnest(${ALL_PERMISSION_KEYS}::text[])
    ON CONFLICT (key) DO NOTHING
  `
  await sql`
    INSERT INTO role_permissions (tenant_id, role_id, permission_id)
    SELECT r.tenant_id, r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.is_system = true AND r.name IN ('Owner', 'Admin')
    ON CONFLICT DO NOTHING
  `

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
