import type { MiddlewareHandler } from "hono"

import type { ControlPlaneEnvironment } from "../index"
import { forbidden } from "../http/errors"
import type { OperatorContext } from "./access"

export const OPERATOR_ROLES = [
  "vendor_owner",
  "vendor_support",
  "release_manager",
  "billing_operator",
  "auditor",
] as const

export type OperatorRole = (typeof OPERATOR_ROLES)[number]

const roleAllowlist = new Set<string>(OPERATOR_ROLES)

export function isOperatorRole(value: string): value is OperatorRole {
  return roleAllowlist.has(value)
}

export function requireOperatorRole(
  ...allowedRoles: readonly OperatorRole[]
): MiddlewareHandler<ControlPlaneEnvironment> {
  const allowed = new Set<OperatorRole>(allowedRoles)

  return async (context, next) => {
    const operator = context.get("operator") as OperatorContext | undefined

    if (!operator || operator.roles.size === 0) {
      throw forbidden()
    }

    for (const role of operator.roles) {
      if (!isOperatorRole(role)) {
        throw forbidden()
      }
    }

    if (![...operator.roles].some((role) => allowed.has(role))) {
      throw forbidden()
    }

    await next()
  }
}
