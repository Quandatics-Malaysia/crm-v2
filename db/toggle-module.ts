import "dotenv/config"
import postgres from "postgres"

/**
 * Operator tool: flip an add-on module flag for a tenant.
 *
 *   npm run module:finance                     # list tenants + current state
 *   npm run module:finance -- demo-entity on
 *   npm run module:finance -- demo-entity off
 *
 * Runs as the privileged role (same as db:migrate), so RLS does not apply.
 */
async function main() {
  const url =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/crm"
  const sql = postgres(url, { max: 1 })

  const [tenant, state] = process.argv.slice(2)

  if (!tenant || !["on", "off"].includes(state ?? "")) {
    const rows = await sql`
      SELECT o.id, o.name, coalesce(ts.finance_module, false) AS finance
      FROM organization o
      LEFT JOIN tenant_settings ts ON ts.organization_id = o.id
      ORDER BY o.name
    `
    console.log("Usage: npm run module:finance -- <tenant-id> on|off\n")
    for (const r of rows) {
      console.log(`  ${r.finance ? "ON " : "off"}  ${r.id}  (${r.name})`)
    }
    await sql.end()
    return
  }

  const [row] = await sql`
    UPDATE tenant_settings
    SET finance_module = ${state === "on"}, updated_at = now()
    WHERE organization_id = ${tenant}
    RETURNING finance_module
  `
  if (!row) {
    console.error(`No tenant_settings row for "${tenant}" — check the id (run with no args to list).`)
    process.exitCode = 1
  } else {
    console.log(`${tenant} finance_module → ${row.finance_module}`)
  }
  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
