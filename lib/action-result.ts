import "server-only"

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
  | { ok: false; error: string }

/**
 * Wrap a mutating Server Action body. Runs `fn`, returning its value as
 * `{ ok: true, data }`. Any thrown `Error` is logged server-side and returned
 * as `{ ok: false, error: message }` so the client can surface it.
 *
 *   export async function deleteThing(id: string): Promise<ActionResult> {
 *     return runAction(async () => {
 *       await withTenant(PERMISSIONS.THING_DELETE, (tx) => ...)
 *       revalidatePath("/things")
 *     })
 *   }
 */
export async function runAction<T>(
  fn: () => Promise<T>
): Promise<ActionResult<[T] extends [void] ? undefined : T>> {
  try {
    const data = await fn()
    // A void-returning body yields `undefined` at runtime; normalize its type
    // to `undefined` so void actions satisfy the documented `Promise<ActionResult>`
    // (= ActionResult<undefined>) without each call site re-annotating ActionResult<void>.
    return { ok: true, data: data as [T] extends [void] ? undefined : T }
  } catch (e) {
    console.error("[action]", e)
    const error = e instanceof Error ? e.message : "Something went wrong"
    return { ok: false, error }
  }
}
