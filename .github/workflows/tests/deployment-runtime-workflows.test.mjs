import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const workflows = resolve(import.meta.dirname, "..")

test("PR previews use one persistent host env for deploy, publication, failure, and close", () => {
  const workflow = readFileSync(resolve(workflows, "pr-preview.yml"), "utf8")
  assert.match(workflow, /pnpm run test:workflows/)
  const provision = workflow.indexOf("manage-preview-deployment.mjs prepare")
  const compose = workflow.indexOf("docker compose")
  assert.ok(provision >= 0, "persistent preview manager is not invoked")
  assert.ok(compose > provision, "preview runtime must be provisioned before Compose")
  assert.match(workflow, /CRM_PREVIEW_STATE_ROOT:-\$HOME\/\.local\/state\/crm-pr-previews/)
  assert.doesNotMatch(workflow, /github\.workspace }}\/\.env\.pr-preview/)
  assert.ok((workflow.match(/manage-preview-deployment\.mjs cleanup/g) ?? []).length >= 2)
  assert.doesNotMatch(workflow, /down -v --remove-orphans \|\| true/)
})

test("staging upgrades retained env through a protected trust-set secret before Compose starts", () => {
  const workflow = readFileSync(resolve(workflows, "deploy-staging.yml"), "utf8")
  assert.match(workflow, /pnpm run test:workflows/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /VENDOR_ENTITLEMENT_TRUST_SET:\s*\$\{\{ secrets\.STAGING_VENDOR_ENTITLEMENT_TRUST_SET \}\}/)
  const provision = workflow.search(/provision-deployment-runtime\.mjs"? --mode staging/)
  const compose = workflow.indexOf("docker compose")
  assert.ok(provision >= 0, "staging runtime provisioner is not invoked")
  assert.ok(compose > provision, "retained staging env must be upgraded before Compose")
})
