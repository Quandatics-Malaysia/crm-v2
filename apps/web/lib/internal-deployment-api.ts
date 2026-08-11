import "server-only"

import { isIP } from "node:net"

export const INTERNAL_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const

export type InternalDeploymentApiLog = {
  event: "internal_deployment_api"
  route: "entitlement" | "status"
  method: "PUT" | "GET"
  outcome: "accepted" | "idempotent" | "rejected" | "unauthorized" | "invalid_request" | "error"
  reason: string | null
  revision: number | null
  status: number
  requestId: string
  remoteIp: string | null
  bodyBytes: number | null
}

export function internalJsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { ...INTERNAL_RESPONSE_HEADERS, ...headers },
  })
}

export function internalRequestMetadata(request: Request): Pick<InternalDeploymentApiLog, "requestId" | "remoteIp"> {
  const suppliedRequestId = request.headers.get("x-request-id")
  const requestId = suppliedRequestId !== null && /^[A-Za-z0-9._-]{1,64}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID()
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? ""
  const direct = request.headers.get("x-real-ip")?.trim() ?? ""
  const candidate = forwarded || direct
  return { requestId, remoteIp: isIP(candidate) === 0 ? null : candidate }
}

export function logInternalDeploymentApi(entry: InternalDeploymentApiLog): void {
  console.info(JSON.stringify(entry))
}
