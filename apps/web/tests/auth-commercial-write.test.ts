import { beforeEach, describe, expect, it, vi } from "vitest"

const adapter = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({ GET: adapter.get, POST: adapter.post })),
}))
vi.mock("@/lib/auth", () => ({ auth: { handler: vi.fn() } }))

import {
  createAuthPostHandler,
  resolveAuthPostOperation,
} from "@/app/api/auth/[...all]/route"
import type { DeploymentAccess } from "@/lib/deployment-control"
import {
  createRouteWriteGuard,
  createWriteAccessGuard,
} from "@/lib/write-access"

function access(mode: "active" | "read_only"): DeploymentAccess {
  return {
    mode,
    reason: mode === "active" ? "Lease is active" : "Subscription is suspended",
    writeAllowed: mode === "active",
    seatLimit: 10,
    moduleIds: [],
    leaseExpiresAt: null,
    graceUntil: null,
    recoveryDeadline: null,
    contractStartsAt: null,
    contractEndsAt: null,
    revision: 1,
    configurationVersion: "config-1",
    subscriptionStatus: mode === "active" ? "active" : "suspended",
    planId: "growth",
  }
}

function request(path: string): Request {
  return new Request(`https://crm.example.test/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
}

describe("Better Auth commercial POST boundary", () => {
  const betterAuth = vi.fn(async () => new Response(null, { status: 204 }))

  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["/sign-in/email", "auth_sign_in"],
    ["/sign-in/social", "auth_sign_in"],
    ["/sign-out", "auth_sign_out"],
    ["/request-password-reset", "auth_account_recovery"],
    ["/reset-password", "auth_account_recovery"],
    ["/reset-password/reset-token", "auth_account_recovery"],
    ["/send-verification-email", "auth_account_recovery"],
    ["/verify-password", "auth_account_security"],
    ["/change-password", "auth_account_security"],
    ["/revoke-session", "auth_session_security"],
    ["/revoke-sessions", "auth_session_security"],
    ["/revoke-other-sessions", "auth_session_security"],
    ["/organization/set-active", "auth_session_context"],
  ] as const)("allows %s in read-only as %s", async (path, operation) => {
    const commercial = createWriteAccessGuard(async () => access("read_only"))
    const post = createAuthPostHandler({
      handler: betterAuth,
      guardWrite: createRouteWriteGuard(commercial.assertWriteAllowed),
    })

    expect(resolveAuthPostOperation(path)).toBe(operation)
    await expect(post(request(path))).resolves.toMatchObject({ status: 204 })
    expect(betterAuth).toHaveBeenCalledOnce()
  })

  it.each([
    "/organization/update",
    "/organization/invite-member",
    "/update-user",
    "/change-email",
    "/unknown-future-mutation",
  ])("default-denies %s before Better Auth while read-only", async (path) => {
    const commercial = createWriteAccessGuard(async () => access("read_only"))
    const post = createAuthPostHandler({
      handler: betterAuth,
      guardWrite: createRouteWriteGuard(commercial.assertWriteAllowed),
    })

    const response = await post(request(path))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LICENSE_READ_ONLY",
        message: "This deployment is read-only. Renew or repair its signed entitlement before making business changes.",
      },
    })
    expect(betterAuth).not.toHaveBeenCalled()
  })

  it("allows default-denied auth mutations while commercial writes are active", async () => {
    const commercial = createWriteAccessGuard(async () => access("active"))
    const post = createAuthPostHandler({
      handler: betterAuth,
      guardWrite: createRouteWriteGuard(commercial.assertWriteAllowed),
    })

    await expect(post(request("/organization/update"))).resolves.toMatchObject({
      status: 204,
    })
    expect(betterAuth).toHaveBeenCalledOnce()
  })
})
