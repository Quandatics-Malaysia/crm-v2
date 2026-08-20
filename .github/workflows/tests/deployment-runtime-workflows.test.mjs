import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const workflows = resolve(import.meta.dirname, "..")

test("staging upgrades retained env through a protected trust-set secret before Compose starts", () => {
  const workflow = readFileSync(resolve(workflows, "deploy-staging.yml"), "utf8")
  assert.match(workflow, /workflows:\s*\[quality\]/)
  assert.match(workflow, /branches:\s*\[main\]/)
  assert.match(readFileSync(resolve(workflows, "quality.yml"), "utf8"), /pnpm run test:workflows/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /CADDY_HOST_PORT=8092/)
  assert.match(workflow, /docker-compose\.staging-images\.yaml/)
  assert.match(workflow, /needs:\s*changes/)
  const stagingImages = readFileSync(resolve(workflows, "publish-staging-images.yml"), "utf8")
  assert.match(stagingImages, /publish:/)
  assert.match(stagingImages, /branches:\s*\[main\]/)
  assert.match(stagingImages, /packages:\s*write/)
  assert.match(stagingImages, /sha-\$\{\{ env\.DEPLOY_SHA \}\}/)
  assert.match(workflow, /VENDOR_ENTITLEMENT_TRUST_SET:\s*\$\{\{ secrets\.STAGING_VENDOR_ENTITLEMENT_TRUST_SET \}\}/)
  const provision = workflow.search(/provision-deployment-runtime\.mjs"? --mode staging/)
  assert.notEqual(-1, provision, "staging provisioner is not invoked")
  const compose = workflow.indexOf("docker compose")
  assert.ok(compose > provision, "retained staging env must be upgraded before Compose")
})
