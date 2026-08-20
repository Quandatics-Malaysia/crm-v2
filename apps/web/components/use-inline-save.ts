"use client"

import * as React from "react"

import { showActionError } from "@/lib/show-action-error"

type InlineSaveFailure = {
  ok: false
  error: string
  contact?: { name: string; role: string }
}

type InlineSaveResult = { ok: boolean; error?: string; contact?: { name: string; role: string } } | void

/** Shared mutation boundary for inline editors and grouped field editors. */
export function useInlineSave<TPatch>(
  action: (patch: TPatch) => Promise<InlineSaveResult>,
  { onSuccess }: { onSuccess?: () => void } = {}
) {
  const [saving, setSaving] = React.useState(false)

  async function save(patch: TPatch): Promise<boolean> {
    setSaving(true)
    try {
      const result = await action(patch)
      if (result && result.ok === false) {
        showActionError(result as InlineSaveFailure)
        return false
      }
      onSuccess?.()
      return true
    } catch (error) {
      showActionError({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save change.",
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  return { save, saving }
}
