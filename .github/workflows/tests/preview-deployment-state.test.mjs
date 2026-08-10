import assert from "node:assert/strict"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { cleanupPreviewDeployment } from "../scripts/manage-preview-deployment.mjs"

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

function withEnvironment(environment, operation) {
  const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]))
  Object.assign(process.env, environment)
  try {
    return operation()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
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

test("existing-runtime cleanup removes the runtime env and every owned remnant after verification", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-existing-remnants-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const tools = join(temporary, "bin")
  mkdirSync(tools)
  makeRepository(checkout)
  fakeDocker(tools)
  const prepared = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(prepared.status, 0, prepared.stderr)
  const envFile = prepared.stdout.trim()
  const previewDirectory = dirname(envFile)
  writeFileSync(join(previewDirectory, ".deployment-runtime-44444444-4444-4444-8444-444444444444.tmp"), "owned-runtime-secret")
  writeFileSync(join(previewDirectory, ".cleanup-55555555-5555-4555-8555-555555555555.env"), "owned-cleanup-secret")
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: join(temporary, "docker.log"),
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const result = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
  assert.equal(existsSync(previewDirectory), false)
})

test("existing-runtime cleanup rejects unknown state before Docker and preserves it", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-existing-unknown-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const tools = join(temporary, "bin")
  const log = join(temporary, "docker.log")
  mkdirSync(tools)
  makeRepository(checkout)
  fakeDocker(tools)
  const prepared = runManager("prepare", { stateRoot, repoRoot: checkout })
  assert.equal(prepared.status, 0, prepared.stderr)
  const envFile = prepared.stdout.trim()
  const unknown = join(dirname(envFile), "unknown-state")
  writeFileSync(unknown, "unknown-secret")
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: log,
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const result = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })

  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, "preview deployment management failed\n")
  assert.equal(existsSync(log), false)
  assert.equal(existsSync(envFile), true)
  assert.equal(readFileSync(unknown, "utf8"), "unknown-secret")
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

test("missing-state cleanup removes only owned runtime and teardown remnants", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-owned-remnants-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const previewDirectory = join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42")
  const tools = join(temporary, "bin")
  mkdirSync(checkout)
  mkdirSync(previewDirectory, { recursive: true })
  mkdirSync(tools)
  fakeDocker(tools)
  writeFileSync(join(previewDirectory, ".deployment-runtime-11111111-1111-4111-8111-111111111111.tmp"), "orphaned-secret")
  writeFileSync(join(previewDirectory, ".cleanup-22222222-2222-4222-8222-222222222222.env"), "orphaned-cleanup-secret")
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: join(temporary, "docker.log"),
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const result = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
  assert.equal(existsSync(previewDirectory), false)
})

test("missing-state cleanup rejects and preserves unknown entries with a bounded error", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-unknown-remnant-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const previewDirectory = join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42")
  const unknown = join(previewDirectory, "keep-me.txt")
  const tools = join(temporary, "bin")
  const log = join(temporary, "docker.log")
  mkdirSync(checkout)
  mkdirSync(previewDirectory, { recursive: true })
  mkdirSync(tools)
  fakeDocker(tools)
  writeFileSync(unknown, "customer-secret-must-remain")
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: log,
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }
  const options = {
    stateRoot,
    repository: "Quandatics-Malaysia/crm-v2",
    prNumber: "42",
    repoRoot: checkout,
  }

  assert.throws(
    () => withEnvironment(environment, () => cleanupPreviewDeployment(options)),
    { message: "Unexpected preview state" },
  )
  assert.equal(readFileSync(unknown, "utf8"), "customer-secret-must-remain")
  assert.equal(existsSync(log), false)

  const cliResult = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })
  assert.notEqual(cliResult.status, 0)
  assert.equal(cliResult.stdout, "")
  assert.equal(cliResult.stderr, "preview deployment management failed\n")
  assert.doesNotMatch(`${cliResult.stdout}${cliResult.stderr}`, /customer-secret|keep-me/)
  assert.equal(readFileSync(unknown, "utf8"), "customer-secret-must-remain")
  assert.equal(existsSync(log), false)
})

test("missing-state cleanup rejects owned-pattern symlinks without touching their targets", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-symlink-remnant-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const previewDirectory = join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42")
  const target = join(temporary, "outside-secret")
  const link = join(previewDirectory, ".deployment-runtime-33333333-3333-4333-8333-333333333333.tmp")
  const tools = join(temporary, "bin")
  const log = join(temporary, "docker.log")
  mkdirSync(checkout)
  mkdirSync(previewDirectory, { recursive: true })
  mkdirSync(tools)
  fakeDocker(tools)
  writeFileSync(target, "outside-secret-must-remain")
  symlinkSync(target, link)
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: log,
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const result = runManager("cleanup", { stateRoot, repoRoot: checkout, environment })

  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "preview deployment management failed\n")
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /outside-secret/)
  assert.equal(existsSync(log), false)
  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(readFileSync(target, "utf8"), "outside-secret-must-remain")
})

test("missing-state cleanup retains its directory until down and residual checks are verified", () => {
  const temporary = mkdtempSync(join(tmpdir(), "crm-preview-unverified-fallback-"))
  const stateRoot = join(temporary, "state")
  const checkout = join(temporary, "checkout")
  const tools = join(temporary, "bin")
  const previewDirectory = join(stateRoot, "Quandatics-Malaysia", "crm-v2", "pr-42")
  mkdirSync(checkout)
  mkdirSync(tools)
  fakeDocker(tools)
  const environment = {
    PATH: `${tools}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: join(temporary, "docker.log"),
    FAKE_DOCKER_SNAPSHOT: join(temporary, "runtime.snapshot"),
  }

  const downFailed = runManager("cleanup", {
    stateRoot,
    repoRoot: checkout,
    environment: { ...environment, FAKE_DOCKER_FAIL_COMPOSE: "1" },
  })
  assert.notEqual(downFailed.status, 0)
  assert.equal(existsSync(previewDirectory), true)
  assert.deepEqual(readdirSync(previewDirectory), [])

  const residualFailed = runManager("cleanup", {
    stateRoot,
    repoRoot: checkout,
    environment: { ...environment, FAKE_DOCKER_REMAINING: "1" },
  })
  assert.notEqual(residualFailed.status, 0)
  assert.equal(existsSync(previewDirectory), true)
  assert.deepEqual(readdirSync(previewDirectory), [])
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
