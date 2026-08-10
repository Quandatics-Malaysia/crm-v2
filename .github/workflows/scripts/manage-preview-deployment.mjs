import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { provisionDeploymentRuntime } from "./provision-deployment-runtime.mjs"

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const prNumberPattern = /^[1-9][0-9]*$/
const ownedTemporaryPattern = /^\.(?:deployment-runtime-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp|cleanup-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.env)$/

function secureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const entry = lstatSync(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new TypeError("Invalid state directory")
  chmodSync(path, 0o700)
}

function previewPaths({ stateRoot, repository, prNumber }) {
  if (
    !repositoryPattern.test(repository) || repository.split("/").some((part) => part === "." || part === "..") ||
    !prNumberPattern.test(prNumber)
  ) {
    throw new TypeError("Invalid preview identity")
  }
  const [owner, name] = repository.split("/")
  const root = resolve(stateRoot)
  const ownerDirectory = join(root, owner)
  const repositoryDirectory = join(ownerDirectory, name)
  const previewDirectory = join(repositoryDirectory, `pr-${prNumber}`)
  return {
    root,
    ownerDirectory,
    repositoryDirectory,
    previewDirectory,
    envFile: join(previewDirectory, "runtime.env"),
    project: `crm-pr-${prNumber}`,
  }
}

function initialEnvironment(prNumber) {
  const adminEmail = `owner-pr-${prNumber}@quandatics-preview.local`
  return [
    `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    `CRM_APP_PASSWORD=${randomBytes(24).toString("hex")}`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
    `PLATFORM_MASTER_EMAIL=${adminEmail}`,
    `PLATFORM_MASTER_PASSWORD=${randomBytes(16).toString("hex")}`,
    `DEMO_ADMIN_EMAIL=${adminEmail}`,
    `DEMO_ADMIN_PASSWORD=${randomBytes(16).toString("hex")}`,
    `DEMO_TENANT_ID=demo-pr-${prNumber}`,
    `DEMO_TENANT_NAME=PR-${prNumber} Demo Workspace`,
    "SEED_SAMPLE_DATA=true",
    `SEED_SAMPLE_PASSWORD=${randomBytes(12).toString("hex")}`,
    "CADDY_BIND_HOST=127.0.0.1",
    "DB_HOST_PORT=0",
    "CADDY_HOST_PORT=0",
    "BETTER_AUTH_URL=http://127.0.0.1",
    "APP_URL=http://127.0.0.1",
    "DOMAIN=preview.quandatics.local",
    "",
  ].join("\n")
}

function securePreviewDirectories(paths) {
  secureDirectory(paths.root)
  secureDirectory(paths.ownerDirectory)
  secureDirectory(paths.repositoryDirectory)
  secureDirectory(paths.previewDirectory)
}

function ensureEnvironment(paths, repoRoot, prNumber) {
  securePreviewDirectories(paths)
  if (!existsSync(paths.envFile)) {
    writeFileSync(paths.envFile, initialEnvironment(prNumber), { encoding: "utf8", mode: 0o600, flag: "wx" })
  } else {
    const entry = lstatSync(paths.envFile)
    if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("Invalid environment file")
  }
  chmodSync(paths.envFile, 0o600)
  provisionDeploymentRuntime({ envFile: paths.envFile, mode: "preview", repoRoot })
}

function cleanupEnvironment(prNumber) {
  const { publicKey } = generateKeyPairSync("ed25519")
  const trustSet = JSON.stringify({
    version: 1,
    keys: [{
      keyId: `cleanup-${randomUUID()}`,
      publicJwk: publicKey.export({ format: "jwk" }),
      validFrom: "2000-01-01T00:00:00.000Z",
      validUntil: "2100-01-01T00:00:00.000Z",
    }],
  })
  return `${initialEnvironment(prNumber)}${[
    `DEPLOYMENT_ID=${randomUUID()}`,
    `AGENT_WEB_SECRET=${randomBytes(32).toString("base64url")}`,
    "APPLICATION_VERSION=0.0.0",
    "MIGRATION_VERSION=0000",
    `VENDOR_ENTITLEMENT_TRUST_SET=${trustSet}`,
    "",
  ].join("\n")}`
}

function cleanupEnvironmentPath(paths, prNumber) {
  securePreviewDirectories(paths)
  if (existsSync(paths.envFile)) {
    const entry = lstatSync(paths.envFile)
    if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("Invalid environment file")
    chmodSync(paths.envFile, 0o600)
    return { path: paths.envFile, temporary: false }
  }
  const temporary = join(paths.previewDirectory, `.cleanup-${randomUUID()}.env`)
  writeFileSync(temporary, cleanupEnvironment(prNumber), { encoding: "utf8", mode: 0o600, flag: "wx" })
  return { path: temporary, temporary: true }
}

function removeOwnedTemporaryState(paths) {
  try {
    const entries = readdirSync(paths.previewDirectory, { withFileTypes: true })
    const ownedFiles = []
    for (const entry of entries) {
      const path = join(paths.previewDirectory, entry.name)
      const metadata = lstatSync(path)
      if (
        !ownedTemporaryPattern.test(entry.name) ||
        entry.isSymbolicLink() || !entry.isFile() ||
        metadata.isSymbolicLink() || !metadata.isFile()
      ) {
        throw new Error("Unexpected preview state")
      }
      ownedFiles.push(path)
    }
    for (const path of ownedFiles) unlinkSync(path)
    if (readdirSync(paths.previewDirectory).length !== 0) throw new Error("Unexpected preview state")
    rmdirSync(paths.previewDirectory)
  } catch (error) {
    if (error instanceof Error && error.message === "Unexpected preview state") throw error
    throw new Error("Unexpected preview state")
  }
}

function runDocker(arguments_) {
  const result = spawnSync("docker", arguments_, { encoding: "utf8" })
  if (result.error !== undefined || result.status !== 0) throw new Error("Docker command failed")
  return result.stdout
}

function verifyProjectRemoved(project) {
  const checks = [
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`],
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`],
  ]
  for (const arguments_ of checks) {
    if (runDocker(arguments_).trim() !== "") throw new Error("Preview resources remain")
  }
}

function composeArguments(paths, repoRoot, envFile) {
  return [
    "compose",
    "-p", paths.project,
    "-f", join(repoRoot, "docker-compose.yaml"),
    "-f", join(repoRoot, "docker-compose.pr-preview.yaml"),
    "-f", join(repoRoot, "docker-compose.staging-tunnel.yaml"),
    "--env-file", envFile,
    "down", "-v", "--remove-orphans",
  ]
}

export function preparePreviewDeployment(options) {
  const paths = previewPaths(options)
  ensureEnvironment(paths, resolve(options.repoRoot), options.prNumber)
  return paths.envFile
}

export function previewEnvironmentPath(options) {
  const paths = previewPaths(options)
  if (!existsSync(paths.envFile)) throw new Error("Preview environment is unavailable")
  const entry = lstatSync(paths.envFile)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new TypeError("Invalid environment file")
  return paths.envFile
}

export function cleanupPreviewDeployment(options) {
  const paths = previewPaths(options)
  const environment = cleanupEnvironmentPath(paths, options.prNumber)
  let removed = false
  try {
    runDocker(composeArguments(paths, resolve(options.repoRoot), environment.path))
    verifyProjectRemoved(paths.project)
    if (!environment.temporary) {
      const contents = readdirSync(paths.previewDirectory)
      if (contents.length !== 1 || contents[0] !== "runtime.env") throw new Error("Unexpected preview state")
      unlinkSync(paths.envFile)
      rmdirSync(paths.previewDirectory)
      removed = true
    } else {
      removeOwnedTemporaryState(paths)
      removed = true
    }
  } finally {
    if (environment.temporary && existsSync(environment.path)) unlinkSync(environment.path)
    if (environment.temporary && !removed && existsSync(paths.previewDirectory) && readdirSync(paths.previewDirectory).length === 0) {
      rmdirSync(paths.previewDirectory)
    }
  }
}

function cliArguments(argv) {
  const [command, ...flags] = argv
  if (!(command === "prepare" || command === "path" || command === "cleanup")) throw new TypeError("Invalid command")
  const values = new Map()
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (!(flags[index] !== undefined && ["--state-root", "--repository", "--pr-number", "--repo-root"].includes(flag)) || value === undefined || values.has(flag)) {
      throw new TypeError("Invalid arguments")
    }
    values.set(flag, value)
  }
  if (["--state-root", "--repository", "--pr-number", "--repo-root"].some((flag) => !values.has(flag))) {
    throw new TypeError("Invalid arguments")
  }
  return {
    command,
    options: {
      stateRoot: values.get("--state-root"),
      repository: values.get("--repository"),
      prNumber: values.get("--pr-number"),
      repoRoot: values.get("--repo-root"),
    },
  }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { command, options } = cliArguments(process.argv.slice(2))
    if (command === "prepare") process.stdout.write(`${preparePreviewDeployment(options)}\n`)
    if (command === "path") process.stdout.write(`${previewEnvironmentPath(options)}\n`)
    if (command === "cleanup") cleanupPreviewDeployment(options)
  } catch {
    process.stderr.write("preview deployment management failed\n")
    process.exitCode = 1
  }
}
