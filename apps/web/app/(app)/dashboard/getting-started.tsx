"use client"

import * as React from "react"
import Link from "next/link"
import { Check, X, ArrowRight, Rocket } from "lucide-react"

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export type ChecklistItem = {
  key: string
  label: string
  description: string
  href: string
  done: boolean
}

const DISMISS_KEY = "crm:dashboard:getting-started-dismissed"

// Tiny localStorage-backed external store so dismissal survives navigation and
// reads without a setState-in-effect (server snapshot is always "not dismissed"
// so the card renders on first paint).
let listeners: Array<() => void> = []
function readDismissed(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(DISMISS_KEY) === "1"
    )
  } catch {
    return false
  }
}
function persistDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1")
  } catch {
    // ignore storage failures (private mode etc.)
  }
  for (const l of listeners) l()
}
function subscribe(cb: () => void) {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}

/** Dismissible setup checklist with derived completion. Seeded items (funnel
 *  stages + currency/tax) arrive pre-checked so progress shows on day one.
 *  Self-hides once every item is complete or the user dismisses it. */
export function GettingStarted({ items }: { items: ChecklistItem[] }) {
  const dismissed = React.useSyncExternalStore(
    subscribe,
    readDismissed,
    () => false
  )

  const doneCount = items.filter((i) => i.done).length
  const allDone = doneCount === items.length

  if (dismissed || allDone) return null

  const pct = Math.round((doneCount / items.length) * 100)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4" />
          Finish setting up
        </CardTitle>
        <CardDescription>
          {doneCount} of {items.length} done — your funnel and SST tax are
          already set up.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={persistDismissed}
            aria-label="Dismiss checklist"
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div
            className="h-full rounded-full bg-[var(--chart-2)] transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.key}>
              {item.done ? (
                <div className="flex items-center gap-3 rounded-md px-2 py-2 text-muted-foreground">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <Check className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm line-through">
                    {item.label}
                  </span>
                </div>
              ) : (
                <Link
                  href={item.href}
                  className="group/row flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
