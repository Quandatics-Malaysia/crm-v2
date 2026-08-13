import { HTTPException } from "hono/http-exception"

export type SafeHttpStatus = 400 | 401 | 403 | 404 | 409 | 503

export class SafeHttpError extends Error {
  readonly status: SafeHttpStatus
  readonly code: string

  constructor(status: SafeHttpStatus, code: string) {
    super(code)
    this.name = "SafeHttpError"
    this.status = status
    this.code = code
  }
}

export function unauthorized(): SafeHttpError {
  return new SafeHttpError(401, "unauthorized")
}

export function forbidden(): SafeHttpError {
  return new SafeHttpError(403, "forbidden")
}

export function badRequest(): SafeHttpError {
  return new SafeHttpError(400, "invalid_request")
}

export function notFound(): SafeHttpError {
  return new SafeHttpError(404, "not_found")
}

export function conflict(): SafeHttpError {
  return new SafeHttpError(409, "conflict")
}

export function authenticationUnavailable(): SafeHttpError {
  return new SafeHttpError(503, "authentication_unavailable")
}

export function safeErrorResponse(error: unknown): { code: string; status: SafeHttpStatus | 500 } {
  if (error instanceof SafeHttpError) {
    return { code: error.code, status: error.status }
  }
  if (error instanceof HTTPException && error.status === 403) {
    return { code: "forbidden", status: 403 }
  }
  return { code: "internal_error", status: 500 }
}

function preference(accept: string, mediaType: string): number {
  let result = 0
  for (const value of accept.split(",")) {
    const [type, ...parameters] = value.trim().toLowerCase().split(";")
    if (type !== mediaType) continue
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="))
    const parsed = quality === undefined ? 1 : Number(quality.trim().slice(2))
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      result = Math.max(result, parsed)
    }
  }
  return result
}

export function acceptsOperatorHtml(request: Request): boolean {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return false
  }
  if (pathname !== "/operator" && !pathname.startsWith("/operator/")) return false

  const accept = request.headers.get("Accept")
  if (!accept) return false
  const html = preference(accept, "text/html")
  return html > 0 && html > preference(accept, "application/json")
}
