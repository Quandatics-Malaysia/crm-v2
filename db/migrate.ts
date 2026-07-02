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

  // pg_trgm powers the fuzzy duplicate-account warnings (similarity()).
  // Requires superuser, which this job runs as; idempotent.
  console.log("→ ensuring pg_trgm extension…")
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`

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

  // Reconcile the partner-facing intercompany mirror. The app keeps it in
  // sync per-mutation (server/services/intercompany.ts); this deploy-time
  // pass backfills deals that predate the mirror table and heals any drift.
  // Runs as superuser, so RLS does not constrain the cross-tenant rows.
  console.log("→ reconciling intercompany mirror…")
  await sql`
    INSERT INTO intercompany_deals (
      tenant_id, opportunity_id, partner_tenant_id, name, account_name,
      currency, estimated_amount, quoted_amount, recognized_percent,
      status, stage_name, stage_probability, include_in_forecast,
      expected_close_date, project_year
    )
    SELECT
      o.tenant_id, o.id, o.handling_partner_entity_id, o.name, a.name,
      o.currency, o.estimated_amount, o.amount, o.recognized_percent,
      o.status, fs.name, fs.probability,
      coalesce(fs.include_in_forecast, true) AND fs.kind IN ('OPEN', 'WON'),
      o.expected_close_date, o.project_year
    FROM opportunities o
    LEFT JOIN accounts a ON a.id = o.account_id
    LEFT JOIN funnel_stages fs ON fs.id = o.current_stage_id
    WHERE o.is_intercompany
      AND o.handling_partner_entity_id IS NOT NULL
      AND o.deleted_at IS NULL
    ON CONFLICT (opportunity_id) DO UPDATE SET
      partner_tenant_id = EXCLUDED.partner_tenant_id,
      name = EXCLUDED.name,
      account_name = EXCLUDED.account_name,
      currency = EXCLUDED.currency,
      estimated_amount = EXCLUDED.estimated_amount,
      quoted_amount = EXCLUDED.quoted_amount,
      recognized_percent = EXCLUDED.recognized_percent,
      status = EXCLUDED.status,
      stage_name = EXCLUDED.stage_name,
      stage_probability = EXCLUDED.stage_probability,
      include_in_forecast = EXCLUDED.include_in_forecast,
      expected_close_date = EXCLUDED.expected_close_date,
      project_year = EXCLUDED.project_year,
      updated_at = now()
  `
  await sql`
    DELETE FROM intercompany_deals icd
    USING opportunities o
    WHERE icd.opportunity_id = o.id
      AND (
        o.deleted_at IS NOT NULL
        OR NOT o.is_intercompany
        OR o.handling_partner_entity_id IS NULL
      )
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
