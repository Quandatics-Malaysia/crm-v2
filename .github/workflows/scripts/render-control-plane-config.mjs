import { existsSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

function required(name, pattern, maximum = 256) {
  const value = process.env[name]?.trim()
  if (!value || value.length > maximum || !pattern.test(value)) throw new Error(`Invalid protected value: ${name}`)
  return value
}

function optional(name, pattern, maximum = 256) {
  const value = process.env[name]?.trim()
  if (!value) return undefined
  if (value.length > maximum || !pattern.test(value)) throw new Error(`Invalid optional value: ${name}`)
  return value
}

const environment = required("CONTROL_PLANE_ENVIRONMENT", /^(staging|production)$/)
const projectDirectory = required("CONTROL_PLANE_PROJECT_DIR", /^\/.+$/, 1024)
const outputPath = required("CONTROL_PLANE_CONFIG_PATH", /^\/.+$/, 1024)
if (!isAbsolute(projectDirectory) || !isAbsolute(outputPath) || !existsSync(join(projectDirectory, "src/index.ts"))) {
  throw new Error("Invalid control-plane paths")
}
const databaseId = required("CONTROL_DB_ID", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
if (databaseId === "00000000-0000-0000-0000-000000000000") throw new Error("Invalid protected value: CONTROL_DB_ID")
const accountId = required("CLOUDFLARE_ACCOUNT_ID", /^[0-9a-f]{32}$/i)
if (/^0+$/.test(accountId)) throw new Error("Invalid protected value: CLOUDFLARE_ACCOUNT_ID")
required("CLOUDFLARE_API_TOKEN", /^.{20,}$/, 4096)
required("INSTALL_TOKEN_PEPPER", /^.{16,}$/, 4096)
const privateJwk = JSON.parse(required("ENTITLEMENT_SIGNING_PRIVATE_JWK", /^\{.+\}$/, 4096))
if (privateJwk?.kty !== "OKP" || privateJwk?.crv !== "Ed25519" ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateJwk?.x ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(privateJwk?.d ?? "")) {
  throw new Error("Invalid protected value: ENTITLEMENT_SIGNING_PRIVATE_JWK")
}
const controlPlaneRoute = optional("CONTROL_PLANE_ROUTE", /^[a-z0-9.-]+\.[a-z0-9.-]+\/\*$/i)

const config = {
  $schema: join(projectDirectory, "node_modules/wrangler/config-schema.json"),
  name: `crm-control-plane-${environment}`,
  main: join(projectDirectory, "src/index.ts"),
  compatibility_date: "2026-08-10",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    ENVIRONMENT: environment,
    ACCESS_TEAM_DOMAIN: required("ACCESS_TEAM_DOMAIN", /^[a-z0-9.-]+$/i),
    ACCESS_AUD: required("ACCESS_AUD", /^[^\s]+$/),
    BOOTSTRAP_OWNER_EMAIL: required("BOOTSTRAP_OWNER_EMAIL", /^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    OPERATOR_ORIGIN: required("OPERATOR_ORIGIN", /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/),
    ENTITLEMENT_SIGNING_KEY_ID: required("ENTITLEMENT_SIGNING_KEY_ID", /^[A-Za-z0-9._:-]+$/, 128),
  },
  secrets: { required: ["ENTITLEMENT_SIGNING_PRIVATE_JWK", "INSTALL_TOKEN_PEPPER"] },
  d1_databases: [{
    binding: "CONTROL_DB",
    database_name: required("CONTROL_DB_NAME", /^[A-Za-z0-9._-]+$/),
    database_id: databaseId,
    migrations_dir: join(projectDirectory, "migrations"),
  }],
  r2_buckets: [{ binding: "BACKUP_VAULT", bucket_name: required("BACKUP_BUCKET_NAME", /^[A-Za-z0-9._-]+$/) }],
  triggers: { crons: ["*/15 * * * *"] },
  observability: {
    enabled: true,
    logs: { head_sampling_rate: 1 },
    traces: { enabled: true, head_sampling_rate: 0.01 },
  },
}

if (controlPlaneRoute !== undefined) {
  config.routes = [{
    pattern: controlPlaneRoute.slice(0, -2),
    custom_domain: true,
  }]
}

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" })
