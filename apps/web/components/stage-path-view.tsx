"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Depth of the chevron arrow (px) and the overlap between segments. Overlapping
// slightly less than the arrow depth leaves a thin sliver of card background
// between segments, which reads as a clean separator.
const ARROW = 14
const OVERLAP = 12

function clipFor(i: number, last: boolean): string {
  if (i === 0) {
    return "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
  }
  if (last) {
    return "polygon(0 0, 100% 0, 100% 100%, 0 100%, 14px 50%)"
  }
  return "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)"
}

export type PathStepState = "done" | "current" | "upcoming"
/** Semantic tone for a step — `won` turns it green once reached. */
export type PathStepTone = "default" | "won"

export type PathStep = {
  id: string
  label: string
  state: PathStepState
  tone?: PathStepTone
  /** When true, the segment can be selected or used as a transition target. */
  clickable?: boolean
  title?: string
}

/** Off-ladder terminal note: a Lost (red) or KIV/parked (amber) state. */
export type PathNote = { label: string; tone: "lost" | "parked" } | null

/**
 * Shared Salesforce-style chevron stage path (presentation only). Used by the
 * funnel (interactive — clicking a target advances) and the lead (read-only).
 *
 * Colours encode outcome consistently across the app:
 *   - won (reached)  → emerald   - done (open) → primary
 *   - current (open) → foreground - upcoming    → muted
 *   - Lost note → red, KIV note → amber.
 */
export function StagePathView({
  steps,
  note,
  hint,
  onStepClick,
  onStepSelect,
}: {
  steps: PathStep[]
  note?: PathNote
  hint?: string
  onStepClick?: (id: string) => void
  onStepSelect?: (id: string) => void
}) {
  return (
    <div className="grid gap-2.5">
      <div className="flex w-full overflow-x-auto py-0.5">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          const clickable = !!s.clickable && (!!onStepClick || !!onStepSelect)
          const won =
            s.tone === "won" && (s.state === "done" || s.state === "current")
          return (
            <button
              key={s.id}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return
                onStepSelect?.(s.id)
                onStepClick?.(s.id)
              }}
              title={s.title}
              style={{
                clipPath: clipFor(i, last),
                marginLeft: i === 0 ? 0 : -OVERLAP,
                paddingLeft: i === 0 ? undefined : ARROW + 6,
              }}
              className={cn(
                "relative flex min-w-[6.5rem] flex-1 items-center justify-center gap-1.5 py-2 pr-4 pl-4 text-xs font-medium transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                won && "bg-emerald-600 text-white dark:bg-emerald-500",
                !won && s.state === "done" && "bg-primary text-primary-foreground",
                !won && s.state === "current" && "bg-foreground text-background",
                !won && s.state === "upcoming" && "bg-muted text-muted-foreground",
                clickable &&
                  "cursor-pointer hover:bg-accent hover:text-accent-foreground",
                !clickable && "cursor-default"
              )}
            >
              {s.state === "done" ? (
                <CheckIcon className="size-3.5 shrink-0" />
              ) : null}
              <span className="truncate">{s.label}</span>
            </button>
          )
        })}
      </div>

      {note ? (
        <div
          className={cn(
            "mx-auto w-fit rounded-full px-3 py-1 text-xs font-medium",
            note.tone === "lost"
              ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          )}
        >
          {note.label}
        </div>
      ) : hint ? (
        <p className="text-center text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
