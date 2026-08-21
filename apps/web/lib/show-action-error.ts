import { toast } from "sonner"
import type { ActionErrorCode } from "@/lib/action-error"

/**
 * Standard failure toast for a mutating Server Action result — replaces the
 * old `toast.error(res.error)` pattern. Appends who to contact when the
 * server resolved one (see lib/permission-denial.ts) instead of dead-ending
 * the user on a bare error string.
 */
export function showActionError(res: {
  ok: false
  error: string
  code?: ActionErrorCode | string
  contact?: { name: string; role: string }
}): void {
  const contactLine = res.contact
    ? ` Contact ${res.contact.name} (${res.contact.role}).`
    : ""
  const message = res.error || "We couldn’t complete this request. Please try again."
  toast.error(message + contactLine)
}
