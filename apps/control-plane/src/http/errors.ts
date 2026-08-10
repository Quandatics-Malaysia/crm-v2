export type SafeHttpStatus = 400 | 401 | 403 | 409 | 503

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

export function authenticationUnavailable(): SafeHttpError {
  return new SafeHttpError(503, "authentication_unavailable")
}
