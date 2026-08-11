import "server-only"
import { humanizeDenial } from "@/lib/permissions"
import { resolveDenialContact, type DenialContact } from "@/lib/permission-denial"
import { requireContext } from "@/lib/server-context"
import {
  LICENSE_READ_ONLY,
  LicenseReadOnlyError,
  assertWriteAllowed,
  type WriteAccessCheck,
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
      code?: typeof LICENSE_READ_ONLY
      contact?: DenialContact
    }

export type RunActionOptions = {
  /** Unknown operation names remain commercial business mutations by default. */
  operation?: string
}

export type ActionRunner = <T>(
  fn: () => Promise<T>,
  options?: RunActionOptions
) => Promise<ActionResult<[T] extends [void] ? undefined : T>>

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
export function createActionRunner(checkWriteAccess: WriteAccessCheck): ActionRunner {
  return async function run<T>(fn: () => Promise<T>, options?: RunActionOptions) {
    try {
      await checkWriteAccess({
        operation: options?.operation ?? "business_mutation",
      })
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
      const rawMessage = e instanceof Error ? e.message : "Something went wrong"
      const isForbidden = rawMessage.startsWith("FORBIDDEN")
      const error = humanizeDenial(rawMessage)
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
