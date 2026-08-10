import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const workflowUrl = new URL("../deploy-control-plane.yml", import.meta.url)
const wranglerUrl = new URL("../../../apps/control-plane/wrangler.jsonc", import.meta.url)
const rendererUrl = new URL("../scripts/render-control-plane-config.mjs", import.meta.url)
const workflow = readFileSync(workflowUrl, "utf8")
const wrangler = readFileSync(wranglerUrl, "utf8")
const nilUuid = "00000000-0000-0000-0000-000000000000"

const validEnvironment = {
  CONTROL_PLANE_ENVIRONMENT: "staging",
  CONTROL_PLANE_PROJECT_DIR: new URL("../../../apps/control-plane", import.meta.url).pathname,
  CONTROL_DB_ID: "7d9f3781-8cd9-43f5-9725-25c238d05e61",
  CONTROL_DB_NAME: "crm-control-plane-staging",
  BACKUP_BUCKET_NAME: "crm-backup-staging",
  ASSETS_SERVICE_NAME: "crm-control-plane-assets-staging",
  ACCESS_TEAM_DOMAIN: "company.cloudflareaccess.com",
  ACCESS_AUD: "staging-access-audience",
  BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
  OPERATOR_ORIGIN: "https://control-staging.example.com",
  ENTITLEMENT_SIGNING_KEY_ID: "vendor-staging-2",
  CLOUDFLARE_ACCOUNT_ID: "1234567890abcdef1234567890abcdef",
  CLOUDFLARE_API_TOKEN: "test-token-is-long-enough",
  ENTITLEMENT_SIGNING_PRIVATE_JWK: JSON.stringify({
    kty: "OKP", crv: "Ed25519", x: "x".repeat(43), d: "d".repeat(43),
  }),
  INSTALL_TOKEN_PEPPER: "pepper-is-long-enough",
}

function render(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "control-config-"))
  const output = join(directory, "wrangler.json")
  const environment = { ...process.env, ...validEnvironment, ...overrides, CONTROL_PLANE_CONFIG_PATH: output }
  for (const [key, value] of Object.entries(environment)) if (value === undefined) delete environment[key]
  return { output, result: spawnSync(process.execPath, [rendererUrl.pathname], { env: environment, encoding: "utf8" }) }
}

test("workflow retains all gates and renders protected environment config", () => {
  for (const gate of ["wrangler types", "d1 migrations apply", "vitest", "deploy --dry-run", "--remote", "wrangler deploy"]) {
    assert.match(workflow, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.match(workflow, /environment:\s*production/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /render-control-plane-config\.mjs/)
  assert.match(workflow, /secrets\.CONTROL_DB_ID/)
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/)
  assert.match(workflow, /--config "\$CONTROL_PLANE_CONFIG_PATH"/)
  assert.doesNotMatch(workflow, /00000000-0000-0000-0000-00000000000[0-9]/)
})

test("committed config stays local-only without deployable resource identifiers", () => {
  assert.match(wrangler, /"crons"\s*:\s*\["\*\/15 \* \* \* \*"\]/)
  assert.match(wrangler, /ENTITLEMENT_SIGNING_KEY_ID/)
  assert.doesNotMatch(wrangler, /"database_id"/)
  assert.doesNotMatch(wrangler, /"env"\s*:/)
  assert.doesNotMatch(wrangler, new RegExp(nilUuid))
})

test("renderer emits a non-secret deploy config only after validating protected values", () => {
  const { output, result } = render()
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(readFileSync(output, "utf8"))
  assert.equal(config.d1_databases[0].database_id, validEnvironment.CONTROL_DB_ID)
  assert.equal(config.vars.ENVIRONMENT, "staging")
  assert.equal(config.triggers.crons[0], "*/15 * * * *")
  assert.equal(statSync(output).mode & 0o777, 0o600)
  const serialized = JSON.stringify(config)
  for (const secret of [validEnvironment.CLOUDFLARE_ACCOUNT_ID, validEnvironment.CLOUDFLARE_API_TOKEN, validEnvironment.ENTITLEMENT_SIGNING_PRIVATE_JWK, validEnvironment.INSTALL_TOKEN_PEPPER]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})

for (const [label, overrides] of [
  ["missing D1 identifier", { CONTROL_DB_ID: undefined }],
  ["invalid D1 identifier", { CONTROL_DB_ID: "not-a-uuid" }],
  ["nil placeholder D1 identifier", { CONTROL_DB_ID: nilUuid }],
  ["missing account identifier", { CLOUDFLARE_ACCOUNT_ID: undefined }],
  ["invalid account identifier", { CLOUDFLARE_ACCOUNT_ID: "0".repeat(32) }],
  ["missing API token", { CLOUDFLARE_API_TOKEN: undefined }],
  ["malformed signing key", { ENTITLEMENT_SIGNING_PRIVATE_JWK: "{}" }],
  ["missing install-token pepper", { INSTALL_TOKEN_PEPPER: undefined }],
]) {
  test(`renderer fails closed for ${label}`, () => {
    const { output, result } = render(overrides)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(output), false)
  })
}
