"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"

import { showActionError } from "@/lib/show-action-error"
import type { ActionResult } from "@/lib/action-result"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

/**
 * Generic chip-list editor for a simple tenant picklist (currencies, payment
 * terms). Empty list = the built-in defaults, shown greyed as a hint.
 */
export function PicklistCard({
  title,
  description,
  items: saved,
  defaults,
  placeholder,
  normalize = (s) => s,
  validate,
  save: saveAction,
}: {
  title: string
  description: string
  items: string[]
  defaults: string[]
  placeholder: string
  normalize?: (s: string) => string
  validate?: (s: string) => string | null
  save: (items: string[]) => Promise<ActionResult<unknown>>
}) {
  const [items, setItems] = React.useState<string[]>(saved)
  // Local baseline so the Save button re-disables after a successful save
  // without waiting for a page refresh to update the `saved` prop.
  const [baseline, setBaseline] = React.useState<string[]>(saved)
  const [draft, setDraft] = React.useState("")
  const [isPending, startTransition] = React.useTransition()
  const dirty = items.join("|") !== baseline.join("|")
  const usingDefaults = items.length === 0

  function add() {
    const v = normalize(draft.trim())
    if (!v) return
    const err = validate?.(v)
    if (err) {
      toast.error(err)
      return
    }
    if (items.includes(v)) {
      toast.error(`"${v}" is already listed.`)
      return
    }
    setItems((p) => [...p, v])
    setDraft("")
  }

  function save() {
    startTransition(async () => {
      const res = await saveAction(items)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setBaseline(items)
      toast.success(`${title} saved`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder={placeholder}
          />
          <Button type="button" variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(usingDefaults ? defaults : items).map((v) => (
            <Badge
              key={v}
              variant={usingDefaults ? "outline" : "secondary"}
              className="gap-1 pr-1"
            >
              {v}
              {!usingDefaults ? (
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((x) => x !== v))}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${v}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
        {usingDefaults ? (
          <p className="text-xs text-muted-foreground">
            {defaults.length > 0
              ? "Using the built-in defaults — add an entry to take over the list."
              : "Nothing configured yet — add the first entry above."}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : `Save ${title.toLowerCase()}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
