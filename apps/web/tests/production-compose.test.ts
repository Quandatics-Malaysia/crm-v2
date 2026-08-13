import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url))
const deploymentEnvironment = {
  POSTGRES_PASSWORD: "compose-test-postgres:@/?#[]",
  CRM_APP_PASSWORD: "compose-test-app:@/?#[]",
  DATABASE_ADMIN_URL: "postgres://postgres:compose-test-postgres%3A%40%2F%3F%23%5B%5D@db:5432/crm",
  MIGRATOR_DATABASE_URL: "postgres://postgres:compose-test-postgres%3A%40%2F%3F%23%5B%5D@db:5432/crm",
  APP_DATABASE_URL: "postgres://crm_app:compose-test-app%3A%40%2F%3F%23%5B%5D@db:5432/crm",
  PGWEB_DATABASE_URL: "postgres://postgres:compose-test-postgres%3A%40%2F%3F%23%5B%5D@db:5432/crm?sslmode=disable",
  BETTER_AUTH_SECRET: "compose-test-auth-secret-with-at-least-32-bytes",
  PLATFORM_MASTER_EMAIL: "owner@example.invalid",
  PLATFORM_MASTER_PASSWORD: "compose-test-owner-password",
  DEPLOYMENT_ID: "11111111-1111-4111-8111-111111111111",
  AGENT_WEB_SECRET: "A".repeat(43),
  APPLICATION_VERSION: "2.3.4",
  MIGRATION_VERSION: "0067",
  VENDOR_ENTITLEMENT_TRUST_SET: "[]",
}

type ComposeService = { environment?: Record<string, string> }

function composeConfig(overrides: Record<string, string | undefined> = {}) {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...deploymentEnvironment }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key]
    else environment[key] = value
  }
  return JSON.parse(execFileSync("docker", [
    "compose",
    "--env-file",
    "/dev/null",
    "--profile",
    "admin",
    "config",
    "--format",
    "json",
  ], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })) as { services: Record<string, ComposeService> }
}

describe("production Compose deployment-control environment", () => {
  it("passes reserved-character-safe derived database URLs through unchanged", () => {
    const config = composeConfig()

    expect(config.services.migrate.environment).toMatchObject({
      DATABASE_ADMIN_URL: deploymentEnvironment.DATABASE_ADMIN_URL,
      DATABASE_URL: deploymentEnvironment.MIGRATOR_DATABASE_URL,
    })
    expect(config.services.web.environment).toMatchObject({
      DATABASE_ADMIN_URL: deploymentEnvironment.DATABASE_ADMIN_URL,
      DATABASE_URL: deploymentEnvironment.APP_DATABASE_URL,
    })
    expect(config.services.backup.environment).toMatchObject({
      DATABASE_ADMIN_URL: deploymentEnvironment.DATABASE_ADMIN_URL,
    })
    expect(config.services.admin.environment).toMatchObject({
      PGWEB_DATABASE_URL: deploymentEnvironment.PGWEB_DATABASE_URL,
    })
  })

  it("passes required deployment identity, shared agent secret, immutable versions, and trust set to web only", () => {
    const config = composeConfig()
    const expected = {
      DEPLOYMENT_ID: deploymentEnvironment.DEPLOYMENT_ID,
      AGENT_WEB_SECRET: deploymentEnvironment.AGENT_WEB_SECRET,
      APPLICATION_VERSION: deploymentEnvironment.APPLICATION_VERSION,
      MIGRATION_VERSION: deploymentEnvironment.MIGRATION_VERSION,
      VENDOR_ENTITLEMENT_TRUST_SET: deploymentEnvironment.VENDOR_ENTITLEMENT_TRUST_SET,
    }
    expect(config.services.web.environment).toMatchObject(expected)

    for (const serviceName of ["db", "migrate", "caddy", "backup"]) {
      for (const key of Object.keys(expected)) {
        expect(config.services[serviceName]?.environment).not.toHaveProperty(key)
      }
    }
  })

  it.each([
    "DEPLOYMENT_ID",
    "AGENT_WEB_SECRET",
    "APPLICATION_VERSION",
    "MIGRATION_VERSION",
    "VENDOR_ENTITLEMENT_TRUST_SET",
  ])("refuses to render production Compose without %s", (key) => {
    expect(() => composeConfig({ [key]: undefined })).toThrow()
  })

  it.each([
    "DATABASE_ADMIN_URL",
    "MIGRATOR_DATABASE_URL",
    "APP_DATABASE_URL",
    "PGWEB_DATABASE_URL",
  ])("refuses to render production Compose without derived %s", (key) => {
    expect(() => composeConfig({ [key]: undefined })).toThrow()
  })
})
