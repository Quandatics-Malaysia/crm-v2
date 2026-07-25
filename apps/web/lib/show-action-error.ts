import { toast } from "sonner"

/**
 * Standard failure toast for a mutating Server Action result — replaces the
 * old `toast.error(res.error)` pattern. Appends who to contact when the
 * server resolved one (see lib/permission-denial.ts) instead of dead-ending
 * the user on a bare error string.
 */
export function showActionError(res: {
  ok: false
  error: string
  contact?: { name: string; role: string }
}): void {
  const contactLine = res.contact
    ? ` Contact ${res.contact.name} (${res.contact.role}).`
    : ""
  toast.error(res.error + contactLine)
}
