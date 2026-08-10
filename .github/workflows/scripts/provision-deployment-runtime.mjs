import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto"
import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/
const migrationVersionPattern = /^[0-9]{4}$/
const strictSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const generatedPlaceholderUuidPattern = /^11111111-1111-4111-8111-11111111111[1-3]$/

function parsedJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function applicationVersion(repoRoot) {
  const value = parsedJson(join(repoRoot, "apps/web/package.json"))?.version
  if (typeof value !== "string" || !strictSemverPattern.test(value)) throw new TypeError("Invalid package version")
  return value
}

function migrationVersion(repoRoot) {
  const entries = parsedJson(join(repoRoot, "apps/web/db/migrations/meta/_journal.json"))?.entries
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("Invalid migration journal")
  let previousIndex = -1
  let previousTimestamp = -1
  let latest = ""
  for (const candidate of entries) {
    const match = typeof candidate?.tag === "string"
      ? candidate.tag.match(/^([0-9]{4})_[A-Za-z0-9_-]+$/)
      : null
    if (
      !Number.isInteger(candidate?.idx) || candidate.idx <= previousIndex ||
      !Number.isSafeInteger(candidate?.when) || candidate.when <= previousTimestamp || candidate.when <= 0 ||
      match === null
    ) {
      throw new TypeError("Invalid migration journal")
    }
    previousIndex = candidate.idx
    previousTimestamp = candidate.when
    latest = match[1]
  }
  return latest
}

function exactKeys(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key))
}

function canonicalBase64Url32(value) {
  if (typeof value !== "string" || !base64Url32Pattern.test(value)) return false
  const decoded = Buffer.from(value, "base64url")
  return decoded.length === 32 && decoded.toString("base64url") === value
}

function parseTrustSet(source) {
  if (typeof source !== "string" || source.length === 0 || source.includes("\n") || source.includes("\r")) {
    throw new TypeError("Invalid trust set")
  }
  const value = JSON.parse(source)
  if (!exactKeys(value, ["version", "keys"]) || value.version !== 1 || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new TypeError("Invalid trust set")
  }
  const keyIds = new Set()
  for (const key of value.keys) {
    if (
      !exactKeys(key, ["keyId", "publicJwk", "validFrom", "validUntil"]) ||
      typeof key.keyId !== "string" || key.keyId.length < 1 || key.keyId.length > 128 || keyIds.has(key.keyId) ||
      !exactKeys(key.publicJwk, ["kty", "crv", "x"], ["alg", "ext", "key_ops"]) ||
      key.publicJwk.kty !== "OKP" || key.publicJwk.crv !== "Ed25519" || !canonicalBase64Url32(key.publicJwk.x) ||
      (key.publicJwk.alg !== undefined && !["EdDSA", "Ed25519"].includes(key.publicJwk.alg)) ||
      (key.publicJwk.ext !== undefined && typeof key.publicJwk.ext !== "boolean") ||
      (key.publicJwk.key_ops !== undefined && (
        !Array.isArray(key.publicJwk.key_ops) || key.publicJwk.key_ops.length > 1 ||
        key.publicJwk.key_ops.some((operation) => operation !== "verify")
      )) ||
      typeof key.validFrom !== "string" || typeof key.validUntil !== "string" ||
      new Date(key.validFrom).toISOString() !== key.validFrom ||
      new Date(key.validUntil).toISOString() !== key.validUntil ||
      Date.parse(key.validUntil) <= Date.parse(key.validFrom)
    ) {
      throw new TypeError("Invalid trust set")
    }
    createPublicKey({ key: key.publicJwk, format: "jwk" })
    keyIds.add(key.keyId)
  }
  return JSON.stringify(value)
}

function previewTrustSet() {
  const { publicKey } = generateKeyPairSync("ed25519")
  return JSON.stringify({
    version: 1,
    keys: [{
      keyId: `preview-${randomUUID()}`,
      publicJwk: publicKey.export({ format: "jwk" }),
      validFrom: "2000-01-01T00:00:00.000Z",
      validUntil: "2100-01-01T00:00:00.000Z",
    }],
  })
}

function parseEnvironment(source) {
  const lines = source.split("\n")
  const values = new Map()
  for (const line of lines) {
    if (line === "" || line.trimStart().startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match === null || values.has(match[1])) throw new TypeError("Invalid environment file")
    values.set(match[1], match[2])
  }
  return { lines, values }
}

function updatedEnvironment(parsed, updates) {
  const remaining = new Map(Object.entries(updates))
  const lines = parsed.lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (match === null || !remaining.has(match[1])) return line
    const value = remaining.get(match[1])
    remaining.delete(match[1])
    return `${match[1]}=${value}`
  })
  while (lines.at(-1) === "") lines.pop()
  if (remaining.size > 0 && lines.length > 0) lines.push("")
  for (const [key, value] of remaining) lines.push(`${key}=${value}`)
  return `${lines.join("\n")}\n`
}

function runtimeIdentity(value) {
  if (value === undefined || value === "" || generatedPlaceholderUuidPattern.test(value)) return randomUUID()
  if (!uuidPattern.test(value)) throw new TypeError("Invalid deployment identity")
  return value
}

function runtimeSecret(value) {
  if (value === undefined || value === "" || value.startsWith("change_me_")) return randomBytes(32).toString("base64url")
  if (!canonicalBase64Url32(value)) throw new TypeError("Invalid agent secret")
  return value
}

function runtimeTrustSet(mode, current, protectedTrustSet) {
  if (mode === "staging") return parseTrustSet(protectedTrustSet)
  if (current === undefined || current === "" || current.startsWith("change_me_")) return previewTrustSet()
  const parsed = parseTrustSet(current)
  const preview = JSON.parse(parsed)
  if (preview.keys.length !== 1 || !preview.keys[0].keyId.startsWith("preview-")) {
    throw new TypeError("Invalid preview trust set")
  }
  return parsed
}

export function provisionDeploymentRuntime({ envFile, mode, repoRoot, protectedTrustSet }) {
  if (!(["preview", "staging"].includes(mode))) throw new TypeError("Invalid provisioning mode")
  const file = lstatSync(envFile)
  if (!file.isFile() || file.isSymbolicLink()) throw new TypeError("Invalid environment file")
  const source = readFileSync(envFile, "utf8")
  const parsed = parseEnvironment(source)
  const updates = {
    DEPLOYMENT_ID: runtimeIdentity(parsed.values.get("DEPLOYMENT_ID")),
    AGENT_WEB_SECRET: runtimeSecret(parsed.values.get("AGENT_WEB_SECRET")),
    APPLICATION_VERSION: applicationVersion(repoRoot),
    MIGRATION_VERSION: migrationVersion(repoRoot),
    VENDOR_ENTITLEMENT_TRUST_SET: runtimeTrustSet(
      mode,
      parsed.values.get("VENDOR_ENTITLEMENT_TRUST_SET"),
      protectedTrustSet,
    ),
  }
  const output = updatedEnvironment(parsed, updates)
  const temporary = join(dirname(envFile), `.deployment-runtime-${randomUUID()}.tmp`)
  writeFileSync(temporary, output, { encoding: "utf8", mode: 0o600, flag: "wx" })
  renameSync(temporary, envFile)
  chmodSync(envFile, 0o600)
}

function cliArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!(["--mode", "--env-file", "--repo-root"].includes(flag)) || value === undefined || values.has(flag)) {
      throw new TypeError("Invalid arguments")
    }
    values.set(flag, value)
  }
  if (!values.has("--mode") || !values.has("--env-file")) throw new TypeError("Invalid arguments")
  return {
    mode: values.get("--mode"),
    envFile: resolve(values.get("--env-file")),
    repoRoot: resolve(values.get("--repo-root") ?? process.cwd()),
  }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    provisionDeploymentRuntime({
      ...cliArguments(process.argv.slice(2)),
      protectedTrustSet: process.env.VENDOR_ENTITLEMENT_TRUST_SET,
    })
  } catch {
    process.stderr.write("deployment runtime provisioning failed\n")
    process.exitCode = 1
  }
}
