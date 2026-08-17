"use client"

import * as React from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  getPpvvcCompletion,
  normalizePpvvcValues,
  type PpvvcPatch,
  type PpvvcValues,
} from "@/lib/ppvvc"

type PpvvcSaveResult = { ok: boolean; error?: string } | void

export function PpvvcEditor({
  values,
  editable = false,
  compact = false,
  onSave,
  className,
}: {
  values: PpvvcPatch | null | undefined
  editable?: boolean
  /** Board cards start as badges and expand into this grouped editor. */
  compact?: boolean
  onSave?: (values: PpvvcValues) => Promise<PpvvcSaveResult>
  className?: string
}) {
  const [draft, setDraft] = React.useState<PpvvcValues>(() =>
    normalizePpvvcValues(values)
  )
  const [expanded, setExpanded] = React.useState(!compact)
  const [saving, startSaving] = React.useTransition()

  const completion = getPpvvcCompletion(draft)

  function update(key: keyof PpvvcValues, value: string) {
    setDraft((current) => ({ ...current, [key]: value || null }))
  }

  function save() {
    if (!onSave) return
    startSaving(async () => {
      try {
        const result = await onSave(normalizePpvvcValues(draft))
        if (result && !result.ok) {
          throw new Error(result.error ?? "Could not save PPVVC")
        }
        toast.success("PPVVC saved")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save PPVVC")
      }
    })
  }

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {completion.map((field) => {
          const badge = (
            <Badge
              key={field.key}
              variant={field.complete ? "default" : "outline"}
              aria-label={`${field.label}: ${field.complete ? "complete" : "missing"}`}
              data-ppvvc-badge={field.key}
              className="text-[11px]"
            >
              {field.number}-{field.label}
            </Badge>
          )
          return compact && editable ? (
            <button
              key={field.key}
              type="button"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded(true)}
              aria-label={`Edit ${field.label}`}
            >
              {badge}
            </button>
          ) : (
            badge
          )
        })}
      </div>

      {expanded ? (
        <div className="grid gap-3">
          {completion.map((field) => (
            <section key={field.key} className="grid gap-1.5 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`ppvvc-${field.key}`}
                  className="text-sm font-medium"
                >
                  {field.number}-{field.label}
                </label>
                <span className="text-xs text-muted-foreground">
                  {field.complete ? "Complete" : "Missing"}
                </span>
              </div>
              {editable ? (
                <Textarea
                  id={`ppvvc-${field.key}`}
                  name={`ppvvc-${field.key}`}
                  value={draft[field.key] ?? ""}
                  onChange={(event) => update(field.key, event.target.value)}
                  rows={3}
                  placeholder={`Describe ${field.label.toLowerCase()}…`}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {draft[field.key] || "—"}
                </p>
              )}
            </section>
          ))}
          {editable && onSave ? (
            <div className="flex items-center justify-end gap-2">
              {compact ? (
                <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>
                  Close
                </Button>
              ) : null}
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save PPVVC"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
