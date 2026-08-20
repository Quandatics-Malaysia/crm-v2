import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8")
const updater = readFileSync(new URL("../../../deploy/client/apply-release-manifest.sh", import.meta.url), "utf8")

test("production deploy uses only a signed source-free release bundle", () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /workflow_run:/)
  assert.match(workflow, /workflows: \[release-images\]/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /client-deployment-bundle-/)
  assert.match(workflow, /gh run download/)
  assert.match(workflow, /workflow_run.*inputs\.operation == 'deploy'/s)
  assert.doesNotMatch(workflow, /ARTIFACT_ID/)
  assert.doesNotMatch(workflow, /\\bunzip\\b/)
  assert.match(workflow, /docker login ghcr\.io/)
  assert.match(workflow, /--password-stdin/)
  assert.match(workflow, /DOCKER_CONFIG/)
  assert.match(workflow, /cosign verify-blob/)
  assert.match(workflow, /WORKFLOW_IDENTITY=.*refs\/tags\/\$\{RELEASE_TAG\}/)
  assert.match(workflow, /--certificate-identity "\$WORKFLOW_IDENTITY"/)
  assert.match(workflow, /apply-release-manifest\.sh/)
  assert.match(workflow, /"\$CLIENT_DIR\/deploy\.sh"/)
  assert.doesNotMatch(workflow, /actions\/checkout|docker compose|--build|git clone|git fetch/)
})

test("manifest updater pins four exact vendor digest repositories", () => {
  for (const repository of ["crm-web", "crm-migrator", "crm-backup", "crm-deployment-agent"]) {
    assert.match(updater, new RegExp(repository))
  }
  assert.match(updater, /sha256:\[0-9a-f\]\{64\}/)
  assert.match(updater, /\.images \| length == 4/)
})
