import "server-only"
import { humanizeDenial } from "@/lib/permissions"
import { resolveDenialContact, type DenialContact } from "@/lib/permission-denial"
import { requireContext } from "@/lib/server-context"
import { normalizeActionError, type ActionErrorCode } from "@/lib/action-error"
import {
  LICENSE_READ_ONLY,
  LicenseReadOnlyError,
  assertWriteAllowed,
  type BusinessWriteAccessCheck,
  type BusinessWriteOperation,
} from "@/lib/write-access"

/**
 * Discriminated result returned by mutating Server Actions.
 *
 * In production, React's Flight encoder strips thrown error messages down to a
 * digest, so expected validation/permission/business-rule failures must be
 * modeled as return values rather than thrown. Read-only actions that run in
 * Server Components keep throwing (they're covered by error.tsx).
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      code?: ActionErrorCode | typeof LICENSE_READ_ONLY
      contact?: DenialContact
    }

export type RunActionOptions = {
  /** New business capabilities use the typed `business:*` default-deny namespace. */
  operation?: BusinessWriteOperation
}

export type ActionRunner = <T>(
  fn: () => Promise<T>,
  options?: RunActionOptions
) => Promise<ActionResult<[T] extends [void] ? undefined : T>>

function isBusinessActionOperation(
  operation: string
): operation is BusinessWriteOperation {
  return (
    operation === "business_mutation" ||
    operation === "membership_mutation" ||
    operation === "api_business_mutation" ||
    operation === "auth_business_mutation" ||
    operation.startsWith("business:")
  )
}

/**
 * Wrap a mutating Server Action body. Runs `fn`, returning its value as
 * `{ ok: true, data }`. Any thrown `Error` is logged server-side and returned
 * as `{ ok: false, error: message }` so the client can surface it. A
 * `FORBIDDEN: ...` message is humanized (no leaked permission keys) and
 * enriched with a `contact` — the user's manager, or an Owner/Admin — so the
 * client can tell them who to ask instead of dead-ending on a raw error.
 *
 *   export async function deleteThing(id: string): Promise<ActionResult> {
 *     return runAction(async () => {
 *       await withTenant(PERMISSIONS.THING_DELETE, (tx) => ...)
 *       revalidatePath("/things")
 *     })
 *   }
 */
export function createActionRunner(checkWriteAccess: BusinessWriteAccessCheck): ActionRunner {
  return async function run<T>(fn: () => Promise<T>, options?: RunActionOptions) {
    const operation = (options?.operation ?? "business_mutation") as string
    if (!isBusinessActionOperation(operation)) {
      return {
        ok: false,
        error: "runAction only accepts business write operations",
      }
    }
    try {
      await checkWriteAccess({ operation })
      const data = await fn()
      // A void-returning body yields `undefined` at runtime; normalize its type
      // to `undefined` so void actions satisfy the documented `Promise<ActionResult>`
      // (= ActionResult<undefined>) without each call site re-annotating ActionResult<void>.
      return { ok: true, data: data as [T] extends [void] ? undefined : T }
    } catch (e) {
      if (e instanceof LicenseReadOnlyError) {
        return { ok: false, code: e.code, error: e.message }
      }
      console.error("[action]", e)
      const normalized = normalizeActionError(e)
      const isForbidden = normalized.code === "forbidden"
      const error = humanizeDenial(normalized.message)
      // Keep the established ActionResult wire shape for compatibility; the
      // normalized code is an internal classification used by this boundary.
      if (!isForbidden) return { ok: false, error }
      // Best-effort: never let contact resolution itself break the error path.
      let contact: DenialContact | undefined
      try {
        const ctx = await requireContext()
        contact = (await resolveDenialContact(ctx)) ?? undefined
      } catch {
        // no active session/tenant to resolve a contact from — fall back below.
      }
      return { ok: false, error, contact }
    }
  }
}

export const runAction: ActionRunner = createActionRunner(assertWriteAllowed)
