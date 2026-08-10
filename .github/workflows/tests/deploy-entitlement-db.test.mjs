import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8")

test("primary CI requires the deployment-control PostgreSQL enforcement suite", () => {
  assert.match(workflow, /services:\s*\n\s*postgres:/)
  assert.match(workflow, /REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS:\s*["']?1["']?/)
  assert.match(workflow, /TEST_DATABASE_ADMIN_URL:\s*postgres:\/\/postgres:/)
  assert.match(workflow, /TEST_DATABASE_URL:\s*postgres:\/\/crm_app:/)
  assert.match(workflow, /pnpm --filter @crm\/control-protocol run build/)
  assert.match(workflow, /pnpm --filter web run db:migrate/)

  const protocolBuild = workflow.indexOf("pnpm --filter @crm/control-protocol run build")
  const migration = workflow.indexOf("pnpm --filter web run db:migrate")
  const tests = workflow.indexOf("REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS")
  assert.ok(protocolBuild >= 0 && migration > protocolBuild, "protocol must build before database migration")
  assert.ok(tests > migration, "database migration must run before required tests")
})
