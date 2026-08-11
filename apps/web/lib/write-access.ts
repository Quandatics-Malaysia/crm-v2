import "server-only"

import {
  getDeploymentAccess,
  type DeploymentAccess,
} from "@/lib/deployment-control"

export const LICENSE_READ_ONLY = "LICENSE_READ_ONLY" as const
export const LICENSE_READ_ONLY_MESSAGE =
  "This deployment is read-only. Renew or repair its signed entitlement before making business changes."

export type OperationalWriteOperation =
  | "export"
  | "encrypted_backup"
  | "license_apply"
  | "license_status"
  | "license_repair"
  | "support_diagnostics"
  | "auth_sign_in"
  | "auth_sign_out"
  | "auth_account_recovery"
  | "auth_account_security"
  | "auth_session_security"
  | "auth_session_context"

export type BusinessWriteOperation =
  | "business_mutation"
  | "membership_mutation"
  | "api_business_mutation"
  | "auth_business_mutation"
  | `business:${string}`

export type WriteOperation = OperationalWriteOperation | BusinessWriteOperation

const OPERATIONAL_OPERATIONS: ReadonlySet<WriteOperation> = new Set([
  "export",
  "encrypted_backup",
  "license_apply",
  "license_status",
  "license_repair",
  "support_diagnostics",
  "auth_sign_in",
  "auth_sign_out",
  "auth_account_recovery",
  "auth_account_security",
  "auth_session_security",
  "auth_session_context",
])

export type WriteAccessInput = {
  /** Named boundary operation. Unknown names are business writes by default. */
  operation: WriteOperation
}

export type WriteAccessCheck = (input: WriteAccessInput) => Promise<void>

export class LicenseReadOnlyError extends Error {
  readonly code = LICENSE_READ_ONLY
  readonly operation: WriteOperation
  readonly reason: string
  readonly recoveryDeadline: string | null

  constructor(input: {
    operation: WriteOperation
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
        recoveryDeadline: access.recoveryDeadline,
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
