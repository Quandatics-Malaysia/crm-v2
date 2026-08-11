import "server-only"

import {
  getDeploymentAccess,
  type DeploymentAccess,
} from "@/lib/deployment-control"

export const LICENSE_READ_ONLY = "LICENSE_READ_ONLY" as const
export const LICENSE_READ_ONLY_MESSAGE =
  "This deployment is read-only. Renew or repair its signed entitlement before making business changes."

const OPERATIONAL_OPERATIONS = new Set([
  "export",
  "encrypted_backup",
  "license_apply",
  "license_status",
  "license_repair",
  "support_diagnostics",
])

export type WriteAccessInput = {
  /** Named boundary operation. Unknown names are business writes by default. */
  operation: string
}

export type WriteAccessCheck = (input: WriteAccessInput) => Promise<void>

export class LicenseReadOnlyError extends Error {
  readonly code = LICENSE_READ_ONLY
  readonly operation: string
  readonly reason: string
  readonly recoveryDeadline: string | null

  constructor(input: {
    operation: string
    reason: string
    recoveryDeadline: string | null
  }) {
    super(LICENSE_READ_ONLY_MESSAGE)
    this.name = "LicenseReadOnlyError"
    this.operation = input.operation
    this.reason = input.reason
    this.recoveryDeadline = input.recoveryDeadline
  }
}

export function createWriteAccessGuard(
  readAccess: () => Promise<DeploymentAccess>
): { assertWriteAllowed: WriteAccessCheck } {
  return {
    async assertWriteAllowed({ operation }) {
      // These operations restore or extract customer data. They must remain
      // available even when entitlement storage itself is absent/unreadable.
      if (OPERATIONAL_OPERATIONS.has(operation)) return

      let access: DeploymentAccess
      try {
        access = await readAccess()
      } catch {
        throw new LicenseReadOnlyError({
          operation,
          reason: "Entitlement state is unavailable",
          recoveryDeadline: null,
        })
      }

      if (
        access.writeAllowed &&
        (access.mode === "active" || access.mode === "grace")
      ) {
        return
      }

      throw new LicenseReadOnlyError({
        operation,
        reason: access.reason,
        recoveryDeadline: access.graceUntil,
      })
    },
  }
}

const runtimeGuard = createWriteAccessGuard(() => getDeploymentAccess())

export const assertWriteAllowed: WriteAccessCheck =
  runtimeGuard.assertWriteAllowed

export function createRouteWriteGuard(assertAllowed: WriteAccessCheck) {
  return async function guardRouteWrite(
    input: WriteAccessInput
  ): Promise<Response | null> {
    try {
      await assertAllowed(input)
      return null
    } catch (error) {
      if (!(error instanceof LicenseReadOnlyError)) throw error
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: 403 }
      )
    }
  }
}

export const guardRouteWrite = createRouteWriteGuard(assertWriteAllowed)
