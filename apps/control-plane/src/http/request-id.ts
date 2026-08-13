import type { Context } from "hono"

import type { ControlPlaneEnvironment } from "../index"

function safeHeaderValue(value: string | undefined): string | undefined {
  return value !== undefined && /^[\x21-\x7e]{1,256}$/.test(value) ? value : undefined
}

export function requestId(context: Context<ControlPlaneEnvironment>): string {
  const cached = context.get("requestCorrelationId")
  if (cached) return cached

  const correlationId = safeHeaderValue(context.req.header("Cf-Ray"))
    ?? safeHeaderValue(context.req.header("X-Request-Id"))
    ?? crypto.randomUUID()
  context.set("requestCorrelationId", correlationId)
  return correlationId
}
