import { describe, expect, it, vi } from "vitest"

import { createDeploymentStatusService } from "@/lib/deployment-status"

const baseAccess = {
  mode: "active" as const,
  reason: "Active entitlement",
  writeAllowed: true,
  seatLimit: 25,
  moduleIds: ["projects" as const],
  leaseExpiresAt: "2026-08-11T00:00:00.000Z",
  graceUntil: "2026-08-18T00:00:00.000Z",
  contractStartsAt: "2026-08-01T00:00:00.000Z",
  contractEndsAt: "2027-08-01T00:00:00.000Z",
  revision: 7,
  configurationVersion: "config-3",
  subscriptionStatus: "active" as const,
  planId: "growth",
}

describe("deployment status service", () => {
  it.each(["active", "grace", "read_only"] as const)("reports truthful %s cached entitlement", async (mode) => {
    const service = createDeploymentStatusService({
      applicationVersion: "2.3.4",
      configuredMigrationVersion: "0067",
      getAccess: vi.fn(async () => ({ ...baseAccess, mode })),
      readRollup: vi.fn(async () => ({
        activeUserCount: 4,
        reservedInvitationCount: 2,
        appliedMigrationVersion: "0067",
      })),
    })

    await expect(service.getStatus(new Date("2026-08-10T12:00:00.000Z"))).resolves.toEqual({
      healthState: "healthy",
      entitlement: {
        revision: "7",
        configurationVersion: "config-3",
        mode,
        enabledModuleIds: ["projects"],
      },
      activeUserCount: 4,
      reservedInvitationCount: 2,
      applicationVersion: "2.3.4",
      migrationVersion: "0067",
    })
  })

  it("reports unhealthy only from an actual absent last-known-good state", async () => {
    const service = createDeploymentStatusService({
      applicationVersion: "2.3.4",
      configuredMigrationVersion: "0067",
      getAccess: vi.fn(async () => ({
        ...baseAccess,
        mode: "read_only" as const,
        writeAllowed: false,
        revision: null,
        configurationVersion: null,
        moduleIds: [],
      })),
      readRollup: vi.fn(async () => ({
        activeUserCount: 0,
        reservedInvitationCount: 0,
        appliedMigrationVersion: "0067",
      })),
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      healthState: "unhealthy",
      entitlement: {
        revision: null,
        configurationVersion: null,
        mode: null,
        enabledModuleIds: [],
      },
      activeUserCount: 0,
      reservedInvitationCount: 0,
    })
  })

  it("fails instead of publishing placeholder counts, bad versions, or unavailable state", async () => {
    const unavailableAccess = vi.fn(async () => { throw new Error("db secret details") })
    const unavailableRollup = vi.fn(async () => { throw new Error("db secret details") })
    const mismatchedVersion = createDeploymentStatusService({
      applicationVersion: "2.3.4",
      configuredMigrationVersion: "0068",
      getAccess: vi.fn(async () => baseAccess),
      readRollup: vi.fn(async () => ({
        activeUserCount: 0,
        reservedInvitationCount: 0,
        appliedMigrationVersion: "0067",
      })),
    })

    await expect(createDeploymentStatusService({
      applicationVersion: "2.3.4",
      configuredMigrationVersion: "0067",
      getAccess: unavailableAccess,
      readRollup: vi.fn(async () => ({ activeUserCount: 0, reservedInvitationCount: 0, appliedMigrationVersion: "0067" })),
    }).getStatus()).rejects.toThrow("db secret details")
    await expect(createDeploymentStatusService({
      applicationVersion: "2.3.4",
      configuredMigrationVersion: "0067",
      getAccess: vi.fn(async () => baseAccess),
      readRollup: unavailableRollup,
    }).getStatus()).rejects.toThrow("db secret details")
    await expect(mismatchedVersion.getStatus()).rejects.toThrow("Applied migration version mismatch")
  })
})
