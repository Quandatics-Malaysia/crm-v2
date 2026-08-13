import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../quality.yml", import.meta.url), "utf8")

test("primary CI requires the deployment-control PostgreSQL enforcement suite", () => {
  assert.match(workflow, /services:\s*\n\s*postgres:/)
  assert.match(workflow, /REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS:\s*["']?1["']?/)
  assert.match(workflow, /TEST_DATABASE_ADMIN_URL:\s*postgres:\/\/postgres:/)
  assert.match(workflow, /TEST_DATABASE_URL:\s*postgres:\/\/crm_app:/)
  assert.match(workflow, /pnpm --filter @crm\/control-protocol run build/)
  assert.match(workflow, /pnpm --filter web run db:migrate/)
  assert.match(workflow, /pnpm run test:workflows/)

  const protocolBuild = workflow.indexOf("pnpm --filter @crm/control-protocol run build")
  const migration = workflow.indexOf("pnpm --filter web run db:migrate")
  const tests = workflow.indexOf("REQUIRE_DEPLOYMENT_CONTROL_DB_TESTS")
  const workflowContract = workflow.indexOf("pnpm run test:workflows")
  assert.ok(protocolBuild >= 0 && migration > protocolBuild, "protocol must build before database migration")
  assert.ok(tests > migration, "database migration must run before required tests")
  assert.ok(workflowContract > tests, "workflow contract must run after the required database suite")
})
