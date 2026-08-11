import { describe, expect, it, vi } from "vitest"

import type { DeploymentAccess } from "@/lib/deployment-control"
import { createActionRunner } from "@/lib/action-result"
import { hasStandingTenantAccess } from "@/lib/server-context"
import { createSubscriptionEntitlementReader } from "@/app/(app)/settings/subscription/actions"
import {
  LicenseReadOnlyError,
  createRouteWriteGuard,
  createWriteAccessGuard,
} from "@/lib/write-access"

function access(
  mode: DeploymentAccess["mode"],
  writeAllowed: boolean,
  reason = "test entitlement state"
): DeploymentAccess {
  return {
    mode,
    reason,
    writeAllowed,
    seatLimit: 25,
    moduleIds: ["projects"],
    leaseExpiresAt: "2026-08-11T00:00:00.000Z",
    graceUntil: "2026-08-18T00:00:00.000Z",
    recoveryDeadline:
      mode === "grace" ? "2026-08-18T00:00:00.000Z" : null,
    contractStartsAt: "2026-08-01T00:00:00.000Z",
    contractEndsAt: "2027-08-01T00:00:00.000Z",
    revision: 7,
    configurationVersion: "config-7",
    subscriptionStatus: "active",
    planId: "growth",
  }
}

describe("commercial write-access boundary", () => {
  it.each([
    ["active", true],
    ["grace", true],
  ] as const)("allows business mutations in %s mode", async (mode, writeAllowed) => {
    const readAccess = vi.fn(async () => access(mode, writeAllowed))
    const guard = createWriteAccessGuard(readAccess)

    await expect(
      guard.assertWriteAllowed({ operation: "business_mutation" })
    ).resolves.toBeUndefined()
    expect(readAccess).toHaveBeenCalledOnce()
  })

  it.each([
    "Subscription is suspended",
    "Subscription is cancelled",
    "Lease grace period has ended",
    "No valid entitlement bundle is available",
    "Entitlement state is unavailable",
  ])("rejects a business mutation when %s", async (reason) => {
    const guard = createWriteAccessGuard(async () =>
      access("read_only", false, reason)
    )

    await expect(
      guard.assertWriteAllowed({ operation: "business_mutation" })
    ).rejects.toMatchObject({
      name: "LicenseReadOnlyError",
      code: "LICENSE_READ_ONLY",
      operation: "business_mutation",
      reason,
      recoveryDeadline: null,
    })
  })

  it.each([
    "export",
    "encrypted_backup",
    "license_apply",
    "license_status",
    "license_repair",
    "support_diagnostics",
  ] as const)("allows explicit operational operation %s without entitlement lookup", async (operation) => {
    const readAccess = vi.fn(async () => {
      throw new Error("unavailable")
    })
    const guard = createWriteAccessGuard(readAccess)

    await expect(guard.assertWriteAllowed({ operation })).resolves.toBeUndefined()
    expect(readAccess).not.toHaveBeenCalled()
  })

  it("default-denies a new business operation while read-only", async () => {
    const guard = createWriteAccessGuard(async () => access("read_only", false))

    await expect(
      guard.assertWriteAllowed({ operation: "business:future_bulk_mutation" })
    ).rejects.toBeInstanceOf(LicenseReadOnlyError)
  })

  it("fails closed when entitlement lookup throws", async () => {
    const guard = createWriteAccessGuard(async () => {
      throw new Error("database unavailable")
    })

    await expect(
      guard.assertWriteAllowed({ operation: "business_mutation" })
    ).rejects.toMatchObject({
      code: "LICENSE_READ_ONLY",
      reason: "Entitlement state is unavailable",
      recoveryDeadline: null,
    })
  })
})

describe("mutating server entrypoints", () => {
  it("central action runner rejects before business work with typed result", async () => {
    const guard = createWriteAccessGuard(async () =>
      access("read_only", false, "Subscription is suspended")
    )
    const runAction = createActionRunner(guard.assertWriteAllowed)
    const work = vi.fn(async () => "mutated")

    await expect(runAction(work)).resolves.toEqual({
      ok: false,
      code: "LICENSE_READ_ONLY",
      error: "This deployment is read-only. Renew or repair its signed entitlement before making business changes.",
    })
    expect(work).not.toHaveBeenCalled()
  })

  it("central action runner permits active business work", async () => {
    const guard = createWriteAccessGuard(async () => access("active", true))
    const runAction = createActionRunner(guard.assertWriteAllowed)

    await expect(runAction(async () => "saved")).resolves.toEqual({
      ok: true,
      data: "saved",
    })
  })

  it("direct route guard returns structured LICENSE_READ_ONLY 403", async () => {
    const guard = createWriteAccessGuard(async () =>
      access("read_only", false, "Lease grace period has ended")
    )
    const routeGuard = createRouteWriteGuard(guard.assertWriteAllowed)

    const response = await routeGuard({ operation: "api_business_mutation" })

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "LICENSE_READ_ONLY",
        message: "This deployment is read-only. Renew or repair its signed entitlement before making business changes.",
      },
    })
  })
})

describe("read context remains available", () => {
  it("keeps active membership access when legacy tenant licensing is inactive", () => {
    expect(hasStandingTenantAccess({
      status: "active",
      tenantSuspended: false,
      subscriptionInactive: true,
    })).toBe(true)
  })

  it.each([
    ["invited", false],
    ["disabled", false],
    ["active", true],
  ] as const)("respects %s membership independently of licensing", (status, expected) => {
    expect(hasStandingTenantAccess({
      status,
      tenantSuspended: false,
      subscriptionInactive: false,
    })).toBe(expected)
  })

  it("still denies a suspended tenant", () => {
    expect(hasStandingTenantAccess({
      status: "active",
      tenantSuspended: true,
      subscriptionInactive: false,
    })).toBe(false)
  })
})

describe("client entitlement details", () => {
  it("lets a non-platform client role read only safe signed commercial fields", async () => {
    const requireContext = vi.fn(async () => ({
      tenantId: "tenant-1",
      isSuperadmin: false,
      roleName: "Viewer",
    }))
    const getAccess = vi.fn(async () => ({
      ...access(
        "grace",
        true,
        "Lease is in offline grace; subscription is past_due"
      ),
      subscriptionStatus: "past_due" as const,
    }))
    const read = createSubscriptionEntitlementReader({
      requireContext,
      getAccess,
    })

    const result = await read()

    expect(result).toEqual({
      mode: "grace",
      reason: "Lease is in offline grace; subscription is past_due",
      writeAllowed: true,
      subscriptionStatus: "past_due",
      planId: "growth",
      seatLimit: 25,
      moduleIds: ["projects"],
      leaseExpiresAt: "2026-08-11T00:00:00.000Z",
      recoveryDeadline: "2026-08-18T00:00:00.000Z",
      contractStartsAt: "2026-08-01T00:00:00.000Z",
      contractEndsAt: "2027-08-01T00:00:00.000Z",
      revision: 7,
      configurationVersion: "config-7",
    })
    expect(JSON.stringify(result)).not.toMatch(
      /signature|private|publicJwk|canonicalEnvelope|keyId/i
    )
  })
})
