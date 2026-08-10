import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/db"
import {
  getDeploymentAccessForStatus,
  type DeploymentAccess,
} from "@/lib/deployment-control"
import { loadInternalDeploymentEnv } from "@/lib/internal-agent-auth"

export type DeploymentStatusRollup = {
  activeUserCount: number
  reservedInvitationCount: number
  appliedMigrationVersion: string
}

export type DeploymentStatus = {
  healthState: "healthy" | "degraded" | "unhealthy"
  entitlement: {
    revision: string | null
    configurationVersion: string | null
    mode: "active" | "grace" | "read_only" | null
    enabledModuleIds: DeploymentAccess["moduleIds"]
  }
  activeUserCount: number
  reservedInvitationCount: number
  applicationVersion: string
  migrationVersion: string
}

type RollupRow = {
  active_user_count: number | string
  reserved_invitation_count: number | string
  applied_migration_version: string
}

export async function readDeploymentStatusRollup(
  database: typeof db = db,
): Promise<DeploymentStatusRollup> {
  const rows = await database.execute(sql`
    select * from read_deployment_status_rollup()
  `) as unknown as RollupRow[]
  const row = rows[0]
  const activeUserCount = Number(row?.active_user_count)
  const reservedInvitationCount = Number(row?.reserved_invitation_count)
  if (
    row === undefined ||
    !Number.isSafeInteger(activeUserCount) || activeUserCount < 0 || activeUserCount > 100_000 ||
    !Number.isSafeInteger(reservedInvitationCount) || reservedInvitationCount < 0 || reservedInvitationCount > 100_000 ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(row.applied_migration_version)
  ) {
    throw new Error("Deployment status rollup returned an invalid result")
  }
  return {
    activeUserCount,
    reservedInvitationCount,
    appliedMigrationVersion: row.applied_migration_version,
  }
}

export function createDeploymentStatusService(input: {
  applicationVersion: string
  configuredMigrationVersion: string
  getAccess: (now: Date) => Promise<DeploymentAccess>
  readRollup: (now: Date) => Promise<DeploymentStatusRollup>
}) {
  return {
    async getStatus(now = new Date()): Promise<DeploymentStatus> {
      const [access, rollup] = await Promise.all([
        input.getAccess(now),
        input.readRollup(now),
      ])
      if (rollup.appliedMigrationVersion !== input.configuredMigrationVersion) {
        throw new Error("Applied migration version mismatch")
      }
      const hasEntitlement = access.revision !== null
      return {
        healthState: hasEntitlement ? "healthy" : "unhealthy",
        entitlement: {
          revision: hasEntitlement ? String(access.revision) : null,
          configurationVersion: hasEntitlement ? access.configurationVersion : null,
          mode: hasEntitlement ? access.mode : null,
          enabledModuleIds: hasEntitlement ? [...access.moduleIds] : [],
        },
        activeUserCount: rollup.activeUserCount,
        reservedInvitationCount: rollup.reservedInvitationCount,
        applicationVersion: input.applicationVersion,
        migrationVersion: rollup.appliedMigrationVersion,
      }
    },
  }
}

export function getDeploymentStatus(now = new Date()): Promise<DeploymentStatus> {
  const environment = loadInternalDeploymentEnv()
  return createDeploymentStatusService({
    applicationVersion: environment.applicationVersion,
    configuredMigrationVersion: environment.migrationVersion,
    getAccess: getDeploymentAccessForStatus,
    readRollup: () => readDeploymentStatusRollup(db),
  }).getStatus(now)
}
