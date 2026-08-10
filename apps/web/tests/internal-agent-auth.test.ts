import { Buffer } from "node:buffer"

import { describe, expect, it, vi } from "vitest"

import {
  createInternalAgentAuthenticator,
  loadInternalDeploymentEnv,
} from "@/lib/internal-agent-auth"

const secret = Buffer.alloc(32, 7).toString("base64url")
const otherSecret = Buffer.alloc(32, 8).toString("base64url")

function request(authorization?: string): Request {
  return new Request("http://web:3000/api/internal/deployment/status", {
    headers: authorization === undefined ? undefined : { authorization },
  })
}

describe("internal deployment agent authentication", () => {
  it("accepts one exact canonical 32-byte Bearer credential", () => {
    const authenticate = createInternalAgentAuthenticator(secret)

    expect(authenticate(request(`Bearer ${secret}`))).toBe("authenticated")
  })

  it.each([
    undefined,
    "",
    `bearer ${secret}`,
    `Bearer  ${secret}`,
    `Bearer ${secret}=`,
    `Bearer ${Buffer.alloc(31, 7).toString("base64url")}`,
    `Bearer ${Buffer.alloc(33, 7).toString("base64url")}`,
    `Bearer ${secret}, Bearer ${secret}`,
    `Bearer ${otherSecret}`,
  ])("returns the same unauthorized result for malformed or wrong credential %s", (authorization) => {
    const authenticate = createInternalAgentAuthenticator(secret)

    expect(authenticate(request(authorization))).toBe("unauthorized")
  })

  it.each([
    "",
    "short",
    `${secret}=`,
    ` ${secret}`,
    Buffer.alloc(31, 7).toString("base64url"),
    Buffer.alloc(33, 7).toString("base64url"),
  ])("distinguishes malformed server configuration without exposing it", (configuredSecret) => {
    const authenticate = createInternalAgentAuthenticator(configuredSecret)

    expect(authenticate(request(`Bearer ${secret}`))).toBe("misconfigured")
  })

  it("always compares two fixed 32-byte arrays for a canonical candidate", () => {
    const compare = vi.fn<(left: Uint8Array, right: Uint8Array) => boolean>(() => false)
    const authenticate = createInternalAgentAuthenticator(secret, compare)

    expect(authenticate(request(`Bearer ${otherSecret}`))).toBe("unauthorized")
    expect(compare).toHaveBeenCalledOnce()
    expect(compare.mock.calls[0]?.[0]).toHaveLength(32)
    expect(compare.mock.calls[0]?.[1]).toHaveLength(32)
  })
})

describe("internal deployment environment", () => {
  const valid = {
    DEPLOYMENT_ID: "11111111-1111-4111-8111-111111111111",
    AGENT_WEB_SECRET: secret,
    APPLICATION_VERSION: "2.3.4-beta.1+build.9",
    MIGRATION_VERSION: "0067",
  }

  it("accepts canonical UUID, strict SemVer, and bounded applied migration version", () => {
    expect(loadInternalDeploymentEnv(valid)).toEqual({
      deploymentId: valid.DEPLOYMENT_ID,
      agentWebSecret: secret,
      applicationVersion: valid.APPLICATION_VERSION,
      migrationVersion: "0067",
    })
  })

  it.each([
    ["DEPLOYMENT_ID", "11111111-1111-4111-A111-111111111111"],
    ["DEPLOYMENT_ID", "quandatics-production"],
    ["AGENT_WEB_SECRET", "secret"],
    ["APPLICATION_VERSION", "latest"],
    ["APPLICATION_VERSION", "1.0.0-01"],
    ["MIGRATION_VERSION", "6"],
    ["MIGRATION_VERSION", "0067 pending"],
    ["MIGRATION_VERSION", ""],
  ])("rejects malformed %s without returning its value", (name, value) => {
    expect(() => loadInternalDeploymentEnv({ ...valid, [name]: value })).toThrowError(
      "Invalid internal deployment configuration",
    )
  })
})
