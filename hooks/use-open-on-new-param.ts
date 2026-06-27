"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Honor the header "+ New" quick-create deep links (`/leads?new=1`, etc.): when
 * the URL carries a `?new` (or `?new=1`) flag, open the page's existing create
 * dialog once, then strip the param via `router.replace` so a refresh or Back
 * navigation doesn't re-open it.
 *
 * @param open    Opens the create dialog (e.g. `() => setNewOpen(true)`).
 * @param enabled Skip entirely when false (e.g. an edit-mode form sharing a
 *                component with the create form).
 */
export function useOpenOnNewParam(open: () => void, enabled = true): void {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const hasNew = searchParams.has("new")

  // Re-run whenever a `?new` flag appears (not just on mount), so the header
  // "+ New" deep link opens the dialog even when already on this list route.
  // After opening we strip the param, which flips `hasNew` back to false.
  React.useEffect(() => {
    if (!enabled || !hasNew) return
    open()
    const params = new URLSearchParams(searchParams.toString())
    params.delete("new")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasNew, pathname])
}
