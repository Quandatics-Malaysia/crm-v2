"use client"

import * as React from "react"
import { PencilIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Button } from "@/components/ui/button"

/**
 * Click-to-edit reference-field value (InlineValue's sibling for pickers
 * instead of free text). Click the display → a Combobox appears in its place;
 * picking an option saves and reverts to display. A cancel (x) button reverts
 * without saving — the Combobox's own popover-based interaction doesn't give
 * us a clean "blur to cancel" the way a plain <input> does.
 */
export function InlineCombobox({
  value,
  display,
  options,
  onSave,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  title,
  className,
}: {
  value: string
  display: React.ReactNode
  options: ComboboxOption[]
  onSave: (next: string) => Promise<void> | void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  title?: string
  className?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [optimisticLabel, setOptimisticLabel] = React.useState<string | null>(null)

  async function commit(next: string) {
    setEditing(false)
    if (next === value) return
    setOptimisticLabel(options.find((o) => o.value === next)?.label ?? "—")
    try {
      await onSave(next)
    } finally {
      setOptimisticLabel(null)
    }
  }

  if (optimisticLabel !== null) {
    return (
      <span aria-busy title="Saving…" className={cn("opacity-60", className)}>
        {optimisticLabel}
      </span>
    )
  }

  if (editing) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1">
        <Combobox
          value={value}
          onChange={commit}
          options={options}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          className="h-7 min-w-0 flex-1 basis-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Cancel"
          onClick={() => setEditing(false)}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
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
