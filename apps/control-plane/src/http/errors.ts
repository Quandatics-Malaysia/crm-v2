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

export function unauthorized(code = "unauthorized"): SafeHttpError {
  return new SafeHttpError(401, code)
}

export function forbidden(code = "forbidden"): SafeHttpError {
  return new SafeHttpError(403, code)
}

export function badRequest(code = "invalid_request"): SafeHttpError {
  return new SafeHttpError(400, code)
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
    const message = typeof error.message === "string" ? error.message.toLowerCase() : ""
    if (message.includes("csrf")) {
      return { code: "csrf_token_invalid", status: 403 }
    }
    return { code: "forbidden", status: 403 }
  }
  return { code: "internal_error", status: 500 }
}

function preference(accept: string, mediaType: string): number {
  const [wantedType, wantedSubtype] = mediaType.split("/")
  let specificity = -1
  let result = 0
  for (const value of accept.split(",")) {
    const [range, ...parameters] = value.trim().toLowerCase().split(";")
    const [type, subtype, extra] = range.trim().split("/")
    if (!type || !subtype || extra || type === "*" && subtype !== "*") continue
    if (type !== "*" && type !== wantedType || subtype !== "*" && subtype !== wantedSubtype) continue
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="))
    const parsed = quality === undefined ? 1 : Number(quality.trim().slice(2))
    const candidate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0
    const candidateSpecificity = type === "*" ? 0 : subtype === "*" ? 1 : 2
    if (candidateSpecificity > specificity) {
      specificity = candidateSpecificity
      result = candidate
    } else if (candidateSpecificity === specificity) {
      result = Math.min(result, candidate)
    }
  }
  return result
}

export function isOperatorRequest(request: Request): boolean {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return false
  }
  return pathname === "/operator" || pathname.startsWith("/operator/")
}

export function acceptsOperatorHtml(request: Request): boolean {
  if (!isOperatorRequest(request)) return false

  const accept = request.headers.get("Accept")
  if (!accept) return false
  const html = preference(accept, "text/html")
  return html > 0 && html > preference(accept, "application/json")
}
