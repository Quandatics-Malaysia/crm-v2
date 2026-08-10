import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const postgresMock = vi.hoisted(() => {
  const sql = Object.assign(
    vi.fn(async () => [{ rolsuper: false, rolbypassrls: false }]),
    { end: vi.fn(async () => undefined) },
  )
  return { connect: vi.fn(() => sql), sql }
})

vi.mock("postgres", () => ({ default: postgresMock.connect }))

import { register } from "@/instrumentation"

const keys = [
  "NEXT_RUNTIME",
  "NODE_ENV",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "DEPLOYMENT_ID",
  "AGENT_WEB_SECRET",
  "APPLICATION_VERSION",
  "MIGRATION_VERSION",
] as const
const originalEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

function validProductionEnvironment(): void {
  Object.assign(process.env, {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    DATABASE_URL: "postgres://crm_app:test@db:5432/crm",
    BETTER_AUTH_SECRET: "production-test-secret-with-at-least-32-bytes",
    DEPLOYMENT_ID: "11111111-1111-4111-8111-111111111111",
    AGENT_WEB_SECRET: "A".repeat(43),
    APPLICATION_VERSION: "2.3.4",
    MIGRATION_VERSION: "0067",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  validProductionEnvironment()
})

afterAll(() => {
  for (const key of keys) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else Object.assign(process.env, { [key]: value })
  }
})

describe("production startup deployment configuration", () => {
  it("accepts canonical internal control identity and immutable release metadata", async () => {
    await expect(register()).resolves.toBeUndefined()
    expect(postgresMock.connect).toHaveBeenCalledOnce()
    expect(postgresMock.sql.end).toHaveBeenCalledOnce()
  })

  it.each([
    ["DEPLOYMENT_ID", "not-a-uuid"],
    ["AGENT_WEB_SECRET", "not-a-secret"],
    ["APPLICATION_VERSION", "latest"],
    ["MIGRATION_VERSION", "6"],
  ] as const)("refuses malformed %s without disclosing its value", async (key, malformed) => {
    process.env[key] = malformed
    await expect(register()).rejects.toThrow("Refusing to start in production")
    try {
      await register()
    } catch (error) {
      expect(String(error)).not.toContain(malformed)
    }
  })
})
