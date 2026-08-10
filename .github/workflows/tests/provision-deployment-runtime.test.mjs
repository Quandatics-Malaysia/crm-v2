import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = resolve(import.meta.dirname, "../scripts/provision-deployment-runtime.mjs")
const repositoryRoot = resolve(import.meta.dirname, "../../..")

function fixture(version = "2.3.4", migrationVersion = "0068") {
  const root = mkdtempSync(join(tmpdir(), "crm-runtime-provision-"))
  mkdirSync(join(root, "apps/web"), { recursive: true })
  mkdirSync(join(root, "apps/web/db/migrations/meta"), { recursive: true })
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ version }))
  const migrationNumber = Number(migrationVersion)
  writeFileSync(join(root, "apps/web/db/migrations/meta/_journal.json"), JSON.stringify({
    entries: [
      { idx: migrationNumber - 1, when: 1_786_381_200_000, tag: `${String(migrationNumber - 1).padStart(4, "0")}_prior` },
      { idx: migrationNumber, when: 1_786_467_600_000, tag: `${migrationVersion}_current` },
    ],
  }))
  const envFile = join(root, ".env.runtime")
  return { root, envFile }
}

function runProvision({ root, envFile }, mode, environment = {}) {
  const childEnvironment = { ...process.env, ...environment }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnvironment[key]
  }
  return spawnSync(process.execPath, [scriptPath, "--mode", mode, "--env-file", envFile, "--repo-root", root], {
    encoding: "utf8",
    env: childEnvironment,
  })
}

function readEnvironment(path) {
  return Object.fromEntries(readFileSync(path, "utf8").trim().split("\n").filter((line) => /^[A-Z]/.test(line)).map((line) => {
    const separator = line.indexOf("=")
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

function validTrustSet() {
  const { publicKey } = generateKeyPairSync("ed25519")
  return JSON.stringify({
    version: 1,
    keys: [{
      keyId: "vendor-staging-test",
      publicJwk: publicKey.export({ format: "jwk" }),
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
    }],
  })
}

test("fresh preview provisioning writes canonical runtime values without emitting secrets", () => {
  const target = fixture()
  writeFileSync(target.envFile, "POSTGRES_PASSWORD=test\n")

  const result = runProvision(target, "preview")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
  const environment = readEnvironment(target.envFile)
  assert.match(environment.DEPLOYMENT_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(environment.AGENT_WEB_SECRET, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(environment.AGENT_WEB_SECRET, "base64url").length, 32)
  assert.equal(environment.APPLICATION_VERSION, "2.3.4")
  assert.equal(environment.MIGRATION_VERSION, "0068")
  const trustSet = JSON.parse(environment.VENDOR_ENTITLEMENT_TRUST_SET)
  assert.equal(trustSet.version, 1)
  assert.equal(trustSet.keys.length, 1)
  assert.deepEqual(Object.keys(trustSet.keys[0].publicJwk).sort(), ["crv", "kty", "x"])
  assert.equal(statSync(target.envFile).mode & 0o777, 0o600)
})

test("reprovision preserves valid identity, secret, and preview trust while advancing immutable metadata", () => {
  const target = fixture()
  writeFileSync(target.envFile, "POSTGRES_PASSWORD=test\n")
  assert.equal(runProvision(target, "preview").status, 0)
  const before = readEnvironment(target.envFile)

  writeFileSync(join(target.root, "apps/web/package.json"), JSON.stringify({ version: "2.4.0" }))
  writeFileSync(join(target.root, "apps/web/db/migrations/meta/_journal.json"), JSON.stringify({
    entries: [{ idx: 69, when: 1_786_554_000_000, tag: "0069_current" }],
  }))
  assert.equal(runProvision(target, "preview").status, 0)
  const after = readEnvironment(target.envFile)
  assert.equal(after.DEPLOYMENT_ID, before.DEPLOYMENT_ID)
  assert.equal(after.AGENT_WEB_SECRET, before.AGENT_WEB_SECRET)
  assert.equal(after.VENDOR_ENTITLEMENT_TRUST_SET, before.VENDOR_ENTITLEMENT_TRUST_SET)
  assert.equal(after.APPLICATION_VERSION, "2.4.0")
  assert.equal(after.MIGRATION_VERSION, "0069")
})

test("legacy template placeholders are upgraded but arbitrary invalid persisted identity fails closed", () => {
  const legacy = fixture()
  writeFileSync(legacy.envFile, [
    "DEPLOYMENT_ID=11111111-1111-4111-8111-111111111112",
    "AGENT_WEB_SECRET=change_me_to_fresh_43_character_base64url_secret",
    "VENDOR_ENTITLEMENT_TRUST_SET=change_me_vendor_issued_json",
    "APPLICATION_VERSION=0.1.0",
    "MIGRATION_VERSION=0067",
    "",
  ].join("\n"))
  assert.equal(runProvision(legacy, "preview").status, 0)
  const upgraded = readEnvironment(legacy.envFile)
  assert.notEqual(upgraded.DEPLOYMENT_ID, "11111111-1111-4111-8111-111111111112")
  assert.match(upgraded.DEPLOYMENT_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(upgraded.AGENT_WEB_SECRET, "change_me_to_fresh_43_character_base64url_secret")
  assert.notEqual(upgraded.VENDOR_ENTITLEMENT_TRUST_SET, "change_me_vendor_issued_json")

  const invalid = fixture()
  const original = "DEPLOYMENT_ID=customer-selected-name\nAGENT_WEB_SECRET=not-valid\n"
  writeFileSync(invalid.envFile, original)
  const result = runProvision(invalid, "preview")
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(invalid.envFile, "utf8"), original)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /customer-selected-name|not-valid/)
})

test("staging requires a protected valid trust set and preserves valid existing identity", () => {
  const target = fixture()
  const deploymentId = "22222222-2222-4222-8222-222222222222"
  const secret = Buffer.alloc(32, 9).toString("base64url")
  const original = `DEPLOYMENT_ID=${deploymentId}\nAGENT_WEB_SECRET=${secret}\n`
  writeFileSync(target.envFile, original)

  let result = runProvision(target, "staging", { VENDOR_ENTITLEMENT_TRUST_SET: undefined })
  assert.notEqual(result.status, 0)
  assert.equal(readFileSync(target.envFile, "utf8"), original)

  result = runProvision(target, "staging", { VENDOR_ENTITLEMENT_TRUST_SET: "not-json" })
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /not-json/)
  assert.equal(readFileSync(target.envFile, "utf8"), original)

  const trustSet = validTrustSet()
  result = runProvision(target, "staging", { VENDOR_ENTITLEMENT_TRUST_SET: trustSet })
  assert.equal(result.status, 0, result.stderr)
  const environment = readEnvironment(target.envFile)
  assert.equal(environment.DEPLOYMENT_ID, deploymentId)
  assert.equal(environment.AGENT_WEB_SECRET, secret)
  assert.deepEqual(JSON.parse(environment.VENDOR_ENTITLEMENT_TRUST_SET), JSON.parse(trustSet))
})

test("preview refuses to reuse a non-preview trust set", () => {
  const target = fixture()
  const original = `VENDOR_ENTITLEMENT_TRUST_SET=${validTrustSet()}\n`
  writeFileSync(target.envFile, original)
  const result = runProvision(target, "preview")
  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, "deployment runtime provisioning failed\n")
  assert.equal(readFileSync(target.envFile, "utf8"), original)
})

test("invalid package or journal metadata leaves the environment unchanged", () => {
  const invalidVersion = fixture("latest")
  const original = "POSTGRES_PASSWORD=test\n"
  writeFileSync(invalidVersion.envFile, original)
  let result = runProvision(invalidVersion, "preview")
  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, "deployment runtime provisioning failed\n")
  assert.equal(readFileSync(invalidVersion.envFile, "utf8"), original)

  const invalidJournal = fixture()
  writeFileSync(invalidJournal.envFile, original)
  writeFileSync(join(invalidJournal.root, "apps/web/db/migrations/meta/_journal.json"), JSON.stringify({
    entries: [{ idx: 68, when: 1, tag: "migration-sixty-eight" }],
  }))
  result = runProvision(invalidJournal, "preview")
  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, "deployment runtime provisioning failed\n")
  assert.equal(readFileSync(invalidJournal.envFile, "utf8"), original)
})

test("provisioned preview environment renders the real production Compose stack", () => {
  const directory = mkdtempSync(join(tmpdir(), "crm-runtime-compose-"))
  const envFile = join(directory, ".env.preview")
  writeFileSync(envFile, [
    "POSTGRES_PASSWORD=compose-test-postgres",
    "CRM_APP_PASSWORD=compose-test-app",
    "BETTER_AUTH_SECRET=compose-test-auth-secret-with-at-least-32-bytes",
    "PLATFORM_MASTER_EMAIL=owner@example.invalid",
    "PLATFORM_MASTER_PASSWORD=compose-test-owner-password",
    "",
  ].join("\n"))
  const provisioned = runProvision({ root: repositoryRoot, envFile }, "preview")
  assert.equal(provisioned.status, 0, provisioned.stderr)

  const composed = spawnSync("docker", [
    "compose",
    "--env-file",
    envFile,
    "-f",
    join(repositoryRoot, "docker-compose.yaml"),
    "config",
    "--quiet",
  ], { cwd: repositoryRoot, encoding: "utf8" })
  assert.equal(composed.status, 0, composed.stderr)
})
