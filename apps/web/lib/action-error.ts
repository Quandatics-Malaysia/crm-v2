export const ACTION_ERROR_CODES = [
  "validation_error",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "internal_error",
] as const

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number]

const TECHNICAL_ERROR = /(?:postgres|postgresql|drizzle|sql(?:state| syntax)?|query failed|database|relation .*does not exist|constraint|unique key|foreign key|syntax error|econn|etimedout|fetch failed|typeerror|referenceerror|cannot read propert|undefined is not|null is not|invalid input syntax|stack trace|internal error|unexpected error|something went wrong)/i
const NOT_FOUND_ERROR = /(?:not found|does not exist|no longer exists|unavailable)/i
const AUTH_ERROR = /^(?:UNAUTHENTICATED|NO_ACTIVE_TENANT|SESSION_EXPIRED)$/i
const FORBIDDEN_ERROR = /^FORBIDDEN\b/i
const CONFLICT_ERROR = /(?:already exists|already .*|just changed|conflict|cannot be.*(?:because|once|after)|can't be.*(?:because|once|after))/i
const VALIDATION_ERROR = /(?:required|must be|invalid|cannot be empty|can't be empty|at least|no more than|exceed|cannot exceed|only .* can|add a valid|choose|select|lower the amount|needs? )/i

function isSafeBusinessMessage(message: string): boolean {
  return (
    message.length > 0 &&
    message.length <= 500 &&
    /^[A-Z]/.test(message) &&
    !TECHNICAL_ERROR.test(message) &&
    !/[\n\r]/.test(message)
  )
}

/** Convert thrown action failures into stable, user-safe results. */
export function normalizeActionError(error: unknown): {
  code: ActionErrorCode
  message: string
} {
  const raw = error instanceof Error ? error.message.trim() : ""

  if (FORBIDDEN_ERROR.test(raw)) {
    return { code: "forbidden", message: raw }
  }
  if (AUTH_ERROR.test(raw)) {
    return {
      code: "unauthenticated",
      message: "Your session has expired. Sign in again and retry.",
    }
  }
  if (TECHNICAL_ERROR.test(raw)) {
    return {
      code: "internal_error",
      message: "We couldn’t complete this request. Please try again.",
    }
  }
  if (NOT_FOUND_ERROR.test(raw)) {
    return {
      code: "not_found",
      message: isSafeBusinessMessage(raw)
        ? raw
        : "The requested record could not be found.",
    }
  }
  if (CONFLICT_ERROR.test(raw)) {
    return {
      code: "conflict",
      message: isSafeBusinessMessage(raw)
        ? raw
        : "This record changed while you were working. Refresh and try again.",
    }
  }
  if (VALIDATION_ERROR.test(raw) && isSafeBusinessMessage(raw)) {
    return { code: "validation_error", message: raw }
  }
  if (isSafeBusinessMessage(raw)) {
    return { code: "validation_error", message: raw }
  }
  return {
    code: "internal_error",
    message: "We couldn’t complete this request. Please try again.",
  }
}
