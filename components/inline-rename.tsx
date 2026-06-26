"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Inline, click-to-edit text. Renders the value as a button; clicking turns it
 * into an input edited in place (Enter/blur saves, Escape cancels) — no dialog.
 */
export function InlineRename({
  value,
  onSave,
  className,
  title = "Click to rename",
}: {
  value: string
  onSave: (next: string) => Promise<void> | void
  className?: string
  title?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)

  function start() {
    setDraft(value)
    setEditing(true)
  }

  async function commit() {
    setEditing(false)
    const next = draft.trim()
    if (!next || next === value) return
    await onSave(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setEditing(false)
          }
        }}
        className={cn(
          "w-full min-w-0 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring",
          className
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      title={title}
      className={cn(
        "truncate text-left hover:underline decoration-dotted underline-offset-2",
        className
      )}
    >
      {value}
    </button>
  )
}
