import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = resolve(import.meta.dirname, "../scripts/manage-preview-deployment.mjs")
function makeRepository(root) {
  mkdirSync(join(root, "apps/web/db/migrations/meta"), { recursive: true })
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ version: "1.0.0" }))
  writeFileSync(join(root, "apps/web/db/migrations/meta/_journal.json"), JSON.stringify({
    entries: [{ idx: 67, when: 1_786_381_200_000, tag: "0067_status" }],
  }))
}

function runManager(command, { stateRoot, repoRoot, prNumber = "42", environment = {} }) {
  return spawnSync(process.execPath, [
    scriptPath,
    command,
    "--state-root", stateRoot,
    "--repository", "Quandatics-Malaysia/crm-v2",
    "--pr-number", prNumber,
    "--repo-root", repoRoot,
  ], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  })
}

function readEnvironment(path) {
  return Object.fromEntries(readFileSync(path, "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf("=")
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

function fakeDocker(directory) {
  const path = join(directory, "docker")
  writeFileSync(path, `#!/usr/bin/env node
import { appendFileSync, copyFileSync, statSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + "\\n")
if (args[0] === "compose") {
  const envIndex = args.indexOf("--env-file")
  if (envIndex >= 0) {
    copyFileSync(args[envIndex + 1], process.env.FAKE_DOCKER_SNAPSHOT)
    if (process.env.FAKE_DOCKER_MODE_LOG) {
      appendFileSync(process.env.FAKE_DOCKER_MODE_LOG, ((statSync(args[envIndex + 1]).mode & 0o777).toString(8)) + "\\n")
    }
  }
  if (process.env.FAKE_DOCKER_FAIL_COMPOSE === "1") process.exit(17)
}
if (args[0] !== "compose" && process.env.FAKE_DOCKER_REMAINING === "1") process.stdout.write("resource-id\\n")
`)
  chmodSync(path, 0o755)
  return path
}

test("preview state survives a checkout clean without rotating deployment credentials", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-state-"))
  const stateRoot = join(temporary, "persistent-state")
  const checkout = join(temporary, "checkout")
  makeRepository(checkout)

  const first = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(first.status, 0, first.stderr)
  const envFile = first.stdout.trim()
  assert.equal(envFile, join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42", "runtime.env"))
  assert.equal(statSync(stateRoot).mode & 0o777, 0o700)
  assert.equal(statSync(dirname(envFile)).mode & 0o777, 0o700)
  assert.equal(statSync(envFile).mode & 0o777, 0o600)
  const before = readEnvironment(envFile)

  rmSync(checkout, { recursive: true })
  makeRepository(checkout)
  const second = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout.trim(), envFile)
  const after = readEnvironment(envFile)
  assert.equal(after.DEPLOYMENT_ID, before.DEPLOYMENT_ID)
  assert.equal(after.AGENT_WEB_SECRET, before.AGENT_WEB_SECRET)
  assert.equal(after.VENDOR_ENTITLEMENT_TRUST_SET, before.VENDOR_ENTITLEMENT_TRUST_SET)

  const otherPr = runManager("prepare", { stateRoot, repoRoot: checkout, prNumber: "43" })
  assert.equal(otherPr.status, 0, otherPr.stderr)
  assert.notEqual(otherPr.stdout.trim(), envFile)
})

test("cleanup uses persisted state unchanged when current release metadata is invalid", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-cleanup-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const tools = join(temporary, "bin")
  const log = join(temporary, "docker.log")
  const snapshot = join(temporary, "runtime.snapshot")
  mkdirSync(tools)
  fakeDocker(tools)
  makeRepository(checkout)

  const prepared = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(prepared.status, 0, prepared.stderr)
  const envFile = prepared.stdout.trim()
  const before = readFileSync(envFile, "utf8")
  writeFileSync(join(checkout, "apps/web/package.json"), JSON.stringify({ version: "latest" }))
  writeFileSync(join(checkout, "apps/web/db/migrations/meta/_journal.json"), "not-json")
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: log,
    FAKE_DOCKER_SNAPSHOT: snapshot,
  }

  const cleaned = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })
  assert.equal(cleaned.status, 0, cleaned.stderr)
  assert.equal(cleaned.stdout, "")
  assert.equal(cleaned.stderr, "")
  const invocations = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
  const compose = invocations.find((args) => args[0] === "compose")
  assert.ok(compose)
  assert.equal(compose[compose.indexOf("--env-file") + 1], envFile)
  assert.ok(compose.includes("down"))
  assert.ok(compose.includes("-v"))
  assert.ok(compose.includes("--remove-orphans"))
  assert.equal(readFileSync(snapshot, "utf8"), before)
  assert.equal(invocations.filter((args) => args[0] !== "compose").length, 3)
  assert.equal(existsSync(envFile), false)
  assert.equal(existsSync(dirname(envFile)), false)
})

test("cleanup creates a secret-safe temporary env when state and release metadata are absent", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-missing-cleanup-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout-without-metadata")
  const tools = join(temporary, "bin")
  const modeLog = join(temporary, "mode.log")
  mkdirSync(tools)
  mkdirSync(checkout)
  fakeDocker(tools)
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: join(temporary, "docker.log"),
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
    FAKE_DOCKER_MODE_LOG: modeLog,
  }

  const absent = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })
  assert.equal(absent.status, 0, absent.stderr)
  assert.equal(absent.stdout, "")
  assert.equal(absent.stderr, "")
  const invocations = readFileSync(environment.FAKE_DOCKER_LOG, "utf8").trim().split("\n").map(JSON.parse)
  assert.ok(invocations.some((args) => args[0] === "compose" && args.includes("down")))
  const fallback = readEnvironment(environment.FAKE_DOCKER_SNAPSHOT)
  assert.match(fallback.DEPLOYMENT_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(fallback.AGENT_WEB_SECRET, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(fallback.APPLICATION_VERSION, "0.0.0")
  assert.equal(fallback.MIGRATION_VERSION, "0000")
  const trustSet = JSON.parse(fallback.VENDOR_ENTITLEMENT_TRUST_SET)
  assert.equal(trustSet.version, 1)
  assert.match(trustSet.keys[0].publicJwk.x, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(readFileSync(modeLog, "utf8"), "600\n")
  const envFile = join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42", "runtime.env")
  assert.equal(existsSync(envFile), false)
  assert.equal(existsSync(dirname(envFile)), false)
})

test("cleanup retains persisted state only when Docker teardown or verification fails", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-failed-cleanup-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const tools = join(temporary, "bin")
  mkdirSync(tools)
  makeRepository(checkout)
  fakeDocker(tools)
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: join(temporary, "docker.log"),
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const prepared = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(prepared.status, 0, prepared.stderr)
  const envFile = prepared.stdout.trim()
  const before = readFileSync(envFile, "utf8")
  writeFileSync(join(checkout, "apps/web/package.json"), JSON.stringify({ version: "invalid" }))
  writeFileSync(join(checkout, "apps/web/db/migrations/meta/_journal.json"), "invalid")
  const failed = runManager("cleanup", {
    stateRoot,
    repoRoot: checkout,
    environment: { ...environment, FAKE_DOCKER_FAIL_COMPOSE: "1" },
  })
  assert.notEqual(failed.status, 0)
  assert.equal(existsSync(envFile), true)
  assert.equal(readFileSync(envFile, "utf8"), before)
  assert.equal(failed.stdout, "")
  assert.equal(failed.stderr, "preview deployment management failed\n")

  const resourcesRemain = runManager("cleanup", {
    stateRoot,
    repoRoot: checkout,
    environment: { ...environment, FAKE_DOCKER_REMAINING: "1" },
  })
  assert.notEqual(resourcesRemain.status, 0)
  assert.equal(existsSync(envFile), true)
  assert.equal(readFileSync(envFile, "utf8"), before)
})
