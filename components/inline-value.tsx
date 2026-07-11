"use client"

import * as React from "react"
import { PencilIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Compact click-to-edit value (mirrors InlineRename, but renders a custom
 * `display` and supports number/date inputs). Enter/blur saves, Escape cancels.
 */
export function InlineValue({
  value,
  display,
  type = "text",
  multiline = false,
  title,
  onSave,
  formatDraft,
  className,
  inputClassName,
}: {
  value: string
  display: React.ReactNode
  type?: "text" | "number" | "date"
  /** Render a textarea instead of an input (Enter inserts a newline; blur saves). */
  multiline?: boolean
  title?: string
  onSave: (next: string) => Promise<void> | void
  /** Format the in-flight draft for the optimistic display while saving. */
  formatDraft?: (next: string) => React.ReactNode
  className?: string
  inputClassName?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  // The committed draft kept on screen while the save is in flight, so the cell
  // shows the new value optimistically instead of flashing the stale one until
  // router.refresh() lands.
  const [optimistic, setOptimistic] = React.useState<string | null>(null)

  function start() {
    setDraft(value)
    setEditing(true)
  }
  async function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next === value.trim()) return
    setOptimistic(next)
    try {
      await onSave(next)
    } finally {
      // Fresh props from the refresh now reflect the saved value.
      setOptimistic(null)
    }
  }

  if (optimistic !== null) {
    return (
      <span
        aria-busy
        title="Saving…"
        className={cn("opacity-60", className)}
      >
        {formatDraft ? formatDraft(optimistic) : optimistic}
      </span>
    )
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className={cn(
            "w-full min-w-0 resize-y rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring",
            inputClassName
          )}
        />
      )
    }
    return (
      <input
        autoFocus
        type={type}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? "0" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          if (type !== "date") e.currentTarget.select()
        }}
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
          "min-w-0 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring",
          inputClassName
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
        "group inline-flex items-center gap-1 text-left hover:underline decoration-dotted underline-offset-2",
        className
      )}
    >
      {display}
      {/* Always-faintly-visible pencil so editability is discoverable. */}
      <PencilIcon
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground/50 group-hover:text-foreground"
      />
    </button>
  )
}
