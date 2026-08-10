import { describe, expect, it, vi } from "vitest"

import {
  createEntitlementRoute,
  dynamic as entitlementDynamic,
  runtime as entitlementRuntime,
} from "@/app/api/internal/deployment/entitlement/route"
import {
  createStatusRoute,
  dynamic as statusDynamic,
  runtime as statusRuntime,
} from "@/app/api/internal/deployment/status/route"
import { InternalJsonRequestError } from "@/lib/internal-json"
import type { EntitlementApplicationResult } from "@/lib/deployment-control"
import type {
  InternalAgentAuthentication,
  InternalDeploymentEnv,
} from "@/lib/internal-agent-auth"
import type { InternalDeploymentApiLog } from "@/lib/internal-deployment-api"

const deploymentId = "11111111-1111-4111-8111-111111111111"
const safeStatus = {
  healthState: "healthy" as const,
  entitlement: {
    revision: "7",
    configurationVersion: "config-3",
    mode: "active" as const,
    enabledModuleIds: ["projects" as const],
  },
  activeUserCount: 3,
  reservedInvitationCount: 1,
  applicationVersion: "2.3.4",
  migrationVersion: "0067",
}

function entitlementRequest(body = '{"keyId":"vendor","payload":{},"signature":"private-signature"}'): Request {
  return new Request("http://web:3000/api/internal/deployment/entitlement", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${"A".repeat(43)}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      "x-request-id": "request-7",
      "x-forwarded-for": "192.0.2.10",
    },
    body,
  })
}

function statusRequest(): Request {
  return new Request("http://web:3000/api/internal/deployment/status", {
    headers: { authorization: `Bearer ${"A".repeat(43)}` },
  })
}

function expectPrivateHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

function entitlementDependencies() {
  return {
    authenticate: vi.fn<(request: Request) => InternalAgentAuthentication>(() => "authenticated"),
    loadEnvironment: vi.fn<() => InternalDeploymentEnv>(() => ({
      deploymentId,
      agentWebSecret: "A".repeat(43),
      applicationVersion: "2.3.4",
      migrationVersion: "0067",
    })),
    readBody: vi.fn(async () => ({ value: { envelope: true }, bodyBytes: 17 })),
    apply: vi.fn<(value: unknown, expectedDeploymentId: string) => Promise<EntitlementApplicationResult>>(
      async () => ({ outcome: "accepted", reason: "accepted", revision: 7 }),
    ),
    getAccess: vi.fn<() => Promise<{ mode: "active" | "grace" | "read_only"; revision: number | null }>>(
      async () => ({ mode: "active", revision: 7 }),
    ),
    log: vi.fn<(entry: InternalDeploymentApiLog) => void>(),
  }
}

describe("PUT internal entitlement route", () => {
  it("uses the Node runtime and is always dynamic", () => {
    expect(entitlementRuntime).toBe("nodejs")
    expect(entitlementDynamic).toBe("force-dynamic")
  })
  it.each(["unauthorized", "misconfigured"] as const)("authenticates before body or database work: %s", async (auth) => {
    const dependencies = entitlementDependencies()
    dependencies.authenticate.mockReturnValue(auth)
    const response = await createEntitlementRoute(dependencies)(entitlementRequest())

    expect(response.status).toBe(auth === "unauthorized" ? 401 : 500)
    expect(await response.json()).toEqual({ error: { code: auth === "unauthorized" ? "unauthorized" : "internal_error" } })
    if (auth === "unauthorized") expect(response.headers.get("www-authenticate")).toBe("Bearer")
    expect(dependencies.loadEnvironment).not.toHaveBeenCalled()
    expect(dependencies.readBody).not.toHaveBeenCalled()
    expect(dependencies.apply).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it.each([
    ["accepted", "accepted"],
    ["idempotent", "idempotent_replay"],
  ] as const)("returns 200 only for %s apply", async (outcome, reason) => {
    const dependencies = entitlementDependencies()
    dependencies.apply.mockResolvedValue({ outcome, reason, revision: 7 })
    const response = await createEntitlementRoute(dependencies)(entitlementRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome, revision: 7, mode: "active" })
    expect(dependencies.apply).toHaveBeenCalledWith({ envelope: true }, deploymentId)
    expectPrivateHeaders(response)
  })

  it.each([
    ["revision_downgrade", 409],
    ["revision_conflict", 409],
    ["invalid_signature", 422],
    ["invalid_payload", 422],
    ["trust_key_not_valid", 422],
    ["deployment_mismatch", 422],
    ["invalid_modules", 422],
    ["expired_lease", 422],
  ])("returns bounded rejection %s with no raw verifier data", async (reason, status) => {
    const dependencies = entitlementDependencies()
    dependencies.apply.mockResolvedValue({ outcome: "rejected", reason, revision: 6 })
    const response = await createEntitlementRoute(dependencies)(entitlementRequest())

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({
      error: { code: "entitlement_rejected", reason },
      currentRevision: 6,
    })
    expect(dependencies.getAccess).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it.each([
    [new InternalJsonRequestError(400, "invalid_request"), 400, "invalid_request"],
    [new InternalJsonRequestError(413, "payload_too_large"), 413, "payload_too_large"],
    [new Error("database connection and password"), 503, "internal_error"],
  ])("returns safe parser or database failure %#", async (error, status, code) => {
    const dependencies = entitlementDependencies()
    if (error instanceof InternalJsonRequestError) dependencies.readBody.mockRejectedValue(error)
    else dependencies.apply.mockRejectedValue(error)
    const response = await createEntitlementRoute(dependencies)(entitlementRequest())

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: { code } })
    expect(JSON.stringify(dependencies.log.mock.calls)).not.toContain("password")
    expectPrivateHeaders(response)
  })

  it("emits fixed-field structured metadata without authorization, body, signature, email, or stack", async () => {
    const dependencies = entitlementDependencies()
    const response = await createEntitlementRoute(dependencies)(entitlementRequest())
    await response.arrayBuffer()

    expect(dependencies.log).toHaveBeenCalledWith({
      event: "internal_deployment_api",
      route: "entitlement",
      method: "PUT",
      outcome: "accepted",
      reason: null,
      revision: 7,
      status: 200,
      requestId: "request-7",
      remoteIp: "192.0.2.10",
      bodyBytes: 17,
    })
    const serialized = JSON.stringify(dependencies.log.mock.calls)
    for (const forbidden of ["Authorization", "private-signature", "email", "stack"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe("GET internal deployment status route", () => {
  it("uses the Node runtime and is always dynamic", () => {
    expect(statusRuntime).toBe("nodejs")
    expect(statusDynamic).toBe("force-dynamic")
  })
  it("returns only safe status DTO with private response headers", async () => {
    const getStatus = vi.fn(async () => safeStatus)
    const response = await createStatusRoute({
      authenticate: vi.fn<(request: Request) => InternalAgentAuthentication>(() => "authenticated"),
      loadEnvironment: vi.fn(() => ({})),
      getStatus,
      log: vi.fn(),
    })(statusRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(safeStatus)
    expectPrivateHeaders(response)
  })

  it("authenticates before environment or database access", async () => {
    const loadEnvironment = vi.fn()
    const getStatus = vi.fn()
    const response = await createStatusRoute({
      authenticate: vi.fn<(request: Request) => InternalAgentAuthentication>(() => "unauthorized"),
      loadEnvironment,
      getStatus,
      log: vi.fn(),
    })(statusRequest())

    expect(response.status).toBe(401)
    expect(loadEnvironment).not.toHaveBeenCalled()
    expect(getStatus).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  it("returns generic 503 instead of placeholder status on database failure", async () => {
    const log = vi.fn()
    const response = await createStatusRoute({
      authenticate: vi.fn<(request: Request) => InternalAgentAuthentication>(() => "authenticated"),
      loadEnvironment: vi.fn(() => ({})),
      getStatus: vi.fn(async () => { throw new Error("user@example.com database details") }),
      log,
    })(statusRequest())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: "internal_error" } })
    expect(JSON.stringify(log.mock.calls)).not.toContain("user@example.com")
    expectPrivateHeaders(response)
  })
})
