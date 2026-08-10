import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createProductionEntitlementRoute } from "@/app/api/internal/deployment/entitlement/route"
import { createProductionStatusRoute } from "@/app/api/internal/deployment/status/route"
import type { EntitlementApplicationResult } from "@/lib/deployment-control"
import type { DeploymentStatus } from "@/lib/deployment-status"
import { env } from "@/lib/env"

const deploymentId = "11111111-1111-4111-8111-111111111111"
const agentSecret = "A".repeat(43)
const originalEnvironment = {
  DEPLOYMENT_ID: env.DEPLOYMENT_ID,
  AGENT_WEB_SECRET: env.AGENT_WEB_SECRET,
  APPLICATION_VERSION: env.APPLICATION_VERSION,
  MIGRATION_VERSION: env.MIGRATION_VERSION,
}
const safeStatus: DeploymentStatus = {
  healthState: "healthy",
  entitlement: {
    revision: "7",
    configurationVersion: "config-3",
    mode: "active",
    enabledModuleIds: ["projects"],
  },
  activeUserCount: 3,
  reservedInvitationCount: 1,
  applicationVersion: "2.3.4",
  migrationVersion: "0067",
}

function setValidEnvironment(): void {
  env.DEPLOYMENT_ID = deploymentId
  env.AGENT_WEB_SECRET = agentSecret
  env.APPLICATION_VERSION = "2.3.4"
  env.MIGRATION_VERSION = "0067"
}

function request(body: BodyInit = "{}", headers: Record<string, string> = {}): Request {
  const byteLength = typeof body === "string" ? Buffer.byteLength(body) : 2
  return new Request("http://web:3000/api/internal/deployment/entitlement", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${agentSecret}`,
      "content-type": "application/json",
      "content-length": String(byteLength),
      ...headers,
    },
    body,
    duplex: body instanceof ReadableStream ? "half" : undefined,
  } as RequestInit & { duplex?: "half" })
}

function expectPrivateHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

beforeEach(() => {
  setValidEnvironment()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})

afterAll(() => Object.assign(env, originalEnvironment))

describe("production PUT composition", () => {
  function dependencies(result: EntitlementApplicationResult = {
    outcome: "accepted",
    reason: "accepted",
    revision: 7,
  }) {
    return {
      apply: vi.fn(async () => result),
      getAccess: vi.fn(async () => ({ mode: "active" as const, revision: 7 })),
    }
  }

  it("uses real authentication before real body parsing or DAL access", async () => {
    const dal = dependencies()
    const response = await createProductionEntitlementRoute(dal)(request("not json", {
      authorization: "Bearer wrong",
      "content-length": "8",
    }))

    expect(response.status).toBe(401)
    expect(dal.apply).not.toHaveBeenCalled()
    expect(dal.getAccess).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it.each([
    ["fatal UTF-8", new Uint8Array([0xc3, 0x28]), { "content-length": "2" }, 400],
    ["duplicate key", '{"x":1,"x":2}', {}, 400],
    ["excessive depth", `${'{"x":'.repeat(65)}0${"}".repeat(65)}`, {}, 400],
    ["declared oversize", "{}", { "content-length": "131073" }, 413],
  ] as const)("rejects %s through the real bounded parser", async (_name, body, headers, status) => {
    const dal = dependencies()
    const response = await createProductionEntitlementRoute(dal)(request(body, headers))

    expect(response.status).toBe(status)
    expect(dal.apply).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it("rejects streamed oversize through the real hard cap", async () => {
    const dal = dependencies()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(131_073))
        controller.close()
      },
    })
    const response = await createProductionEntitlementRoute(dal)(request(stream, {
      "content-length": "131072",
    }))

    expect(response.status).toBe(413)
    expect(dal.apply).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it.each([
    [{ outcome: "accepted", reason: "accepted", revision: 7 }, 200],
    [{ outcome: "idempotent", reason: "idempotent_replay", revision: 7 }, 200],
    [{ outcome: "rejected", reason: "revision_conflict", revision: 7 }, 409],
    [{ outcome: "rejected", reason: "invalid_signature", revision: 7 }, 422],
  ] as const)("maps real route result %# to %s", async (result, status) => {
    const dal = dependencies(result)
    const response = await createProductionEntitlementRoute(dal)(request())
    expect(response.status).toBe(status)
    expectPrivateHeaders(response)
  })

  it("returns generic failures for malformed server config and DAL errors", async () => {
    const malformedDal = dependencies()
    env.AGENT_WEB_SECRET = "not-a-secret"
    const malformed = await createProductionEntitlementRoute(malformedDal)(request())
    expect(malformed.status).toBe(500)
    expect(await malformed.json()).toEqual({ error: { code: "internal_error" } })
    expect(malformedDal.apply).not.toHaveBeenCalled()
    expectPrivateHeaders(malformed)

    setValidEnvironment()
    const failedDal = dependencies()
    failedDal.apply.mockRejectedValue(new Error("database user@example.com"))
    const failed = await createProductionEntitlementRoute(failedDal)(request())
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: { code: "internal_error" } })
    expectPrivateHeaders(failed)
  })
})

describe("production GET composition", () => {
  it("uses real auth, returns the status DTO, and never caches either outcome", async () => {
    const getStatus = vi.fn(async () => safeStatus)
    const get = createProductionStatusRoute({ getStatus })
    const unauthorized = await get(new Request("http://web:3000/api/internal/deployment/status"))
    expect(unauthorized.status).toBe(401)
    expect(getStatus).not.toHaveBeenCalled()
    expectPrivateHeaders(unauthorized)

    const accepted = await get(new Request("http://web:3000/api/internal/deployment/status", {
      headers: { authorization: `Bearer ${agentSecret}` },
    }))
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual(safeStatus)
    expect(getStatus).toHaveBeenCalledOnce()
    expectPrivateHeaders(accepted)
  })

  it("returns generic 503 when the real route's status DAL fails", async () => {
    const get = createProductionStatusRoute({
      getStatus: vi.fn(async () => { throw new Error("database user@example.com") }),
    })
    const response = await get(new Request("http://web:3000/api/internal/deployment/status", {
      headers: { authorization: `Bearer ${agentSecret}` },
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: "internal_error" } })
    expectPrivateHeaders(response)
  })
})
