"use client"

import * as React from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useInlineSave } from "@/components/use-inline-save"
import {
  PPVVC_FIELDS,
  getPpvvcDirtyPatch,
  getPpvvcCompletion,
  mergePpvvcDraft,
  normalizePpvvcValues,
  formatPpvvcSectionLabel,
  type PpvvcField,
  type PpvvcPatch,
  type PpvvcValues,
} from "@/lib/ppvvc"

type PpvvcSaveResult = { ok: boolean; error?: string } | void

export function PpvvcEditor({
  values,
  editable = false,
  compact = false,
  fields,
  onSave,
  className,
}: {
  values: PpvvcPatch | null | undefined
  editable?: boolean
  /** Board cards start as badges and expand into this grouped editor. */
  compact?: boolean
  /** Optional subset for stage dialogs; omitted means all five sections. */
  fields?: readonly { key: PpvvcField }[]
  onSave?: (values: PpvvcPatch) => Promise<PpvvcSaveResult>
  className?: string
}) {
  const [draft, setDraft] = React.useState<PpvvcValues>(() =>
    normalizePpvvcValues(values)
  )
  const [expanded, setExpanded] = React.useState(!compact)
  const { save: saveInline, saving } = useInlineSave<PpvvcPatch>(
    async (patch) => {
      if (!onSave) return
      return onSave(patch)
    }
  )
  const serverValuesRef = React.useRef(normalizePpvvcValues(values))

  React.useEffect(() => {
    const refreshed = normalizePpvvcValues(values)
    const previousServer = serverValuesRef.current
    setDraft((current) => mergePpvvcDraft(previousServer, current, refreshed))
    serverValuesRef.current = refreshed
  }, [values])

  const completion = getPpvvcCompletion(draft)
  const visibleKeys = new Set((fields ?? PPVVC_FIELDS).map((field) => field.key))
  const visibleCompletion = completion.filter((field) => visibleKeys.has(field.key))
  const completeCount = visibleCompletion.filter((field) => field.complete).length

  function update(key: keyof PpvvcValues, value: string) {
    setDraft((current) => ({ ...current, [key]: value || null }))
  }

  function save() {
    if (!onSave) return
    void (async () => {
      const submitted = normalizePpvvcValues(draft)
      const patch = getPpvvcDirtyPatch(serverValuesRef.current, submitted)
      if (Object.keys(patch).length === 0) return
      if (!(await saveInline(patch))) return
      const refreshed = normalizePpvvcValues({
        ...serverValuesRef.current,
        ...patch,
      })
      serverValuesRef.current = refreshed
      setDraft((current) => mergePpvvcDraft(submitted, current, refreshed))
      toast.success("PPVVC saved")
    })()
  }

  const status = `${completeCount}/${visibleCompletion.length} complete`

  const badges = (
    <div className="flex flex-wrap items-center gap-1.5">
        {visibleCompletion.map((field) => {
          const badge = (
            <Badge
              key={field.key}
              variant={field.complete ? "default" : "outline"}
              aria-label={`${field.label}: ${field.complete ? "complete" : "missing"}`}
              data-ppvvc-badge={field.key}
              className="text-[11px]"
            >
              {formatPpvvcSectionLabel(field)}
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
  )

  if (compact && !expanded) {
    return <div className={cn("grid gap-2", className)}>{badges}</div>
  }

  return (
    <Card className={cn("gap-0", className)}>
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="text-sm">PPVVC analysis</CardTitle>
            <CardDescription>
              Power Sponsor, Pain, Vision, Value, and Control
            </CardDescription>
          </div>
          <Badge variant={completeCount === visibleCompletion.length ? "default" : "secondary"}>
            {status}
          </Badge>
        </div>
        <div className="pt-1">{badges}</div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        {expanded ? (
          <div className="grid gap-3">
          {visibleCompletion.map((field) => (
            <section
              key={field.key}
              className="grid gap-2 rounded-lg border bg-background p-3 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    field.complete
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {field.number}
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`ppvvc-${field.key}`} className="text-sm font-medium">
                      {formatPpvvcSectionLabel(field)}
                    </label>
                    <Badge variant={field.complete ? "default" : "outline"}>
                      {field.complete ? "Complete" : "Missing"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {field.complete
                      ? "Recorded on the Opportunity"
                      : "Add this before advancing the stage"}
                  </p>
                </div>
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
          </div>
      ) : null}
      </CardContent>
      {editable && onSave ? (
        <CardFooter className="justify-end gap-2">
          {compact ? (
            <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>
              Close
            </Button>
          ) : null}
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save PPVVC"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
