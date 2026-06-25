import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

export type ProgressState = "done" | "current" | "upcoming" | "terminal"
export type ProgressStep = {
  id: string
  label: string
  state: ProgressState
}

/** Horizontal stepper used for funnel stages and lead status. */
export function StageProgress({
  steps,
  note,
}: {
  steps: ProgressStep[]
  /** Optional terminal note shown when off the linear track (Lost / KIV / Disqualified). */
  note?: { label: string; tone?: "lost" | "parked" } | null
}) {
  return (
    <div className="grid gap-2">
      <ol className="flex w-full items-center">
        {steps.map((s, i) => {
          const filledLeft = s.state === "done" || s.state === "current"
          const filledRight = s.state === "done"
          return (
            <li key={s.id} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    i === 0 ? "opacity-0" : filledLeft ? "bg-primary" : "bg-muted"
                  )}
                />
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    s.state === "done" && "border-primary bg-primary text-primary-foreground",
                    s.state === "current" && "border-primary text-primary ring-2 ring-primary/25",
                    s.state === "upcoming" && "border-muted-foreground/30 text-muted-foreground",
                    s.state === "terminal" && "border-destructive bg-destructive/10 text-destructive"
                  )}
                >
                  {s.state === "done" ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    i === steps.length - 1 ? "opacity-0" : filledRight ? "bg-primary" : "bg-muted"
                  )}
                />
              </div>
              <span
                className={cn(
                  "max-w-24 truncate text-center text-[11px] leading-tight",
                  s.state === "current"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>
      {note ? (
        <p
          className={cn(
            "text-center text-xs font-medium",
            note.tone === "lost" ? "text-destructive" : "text-amber-600 dark:text-amber-500"
          )}
        >
          {note.label}
        </p>
      ) : null}
    </div>
  )
}

type FunnelStageLike = {
  id: string
  name: string
  kind: string
  sortOrder: number
}

/** Build the linear OPEN→WON ladder, marking done/current/upcoming. Lost/KIV
 *  current stages render as a terminal note instead of a step. */
export function buildFunnelSteps(
  stages: FunnelStageLike[],
  currentStageId: string
): { steps: ProgressStep[]; note: { label: string; tone: "lost" | "parked" } | null } {
  const ladder = stages
    .filter((s) => s.kind === "OPEN" || s.kind === "WON")
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const current = stages.find((s) => s.id === currentStageId)
  const currentIdx = ladder.findIndex((s) => s.id === currentStageId)

  let note: { label: string; tone: "lost" | "parked" } | null = null
  if (current?.kind === "LOST") note = { label: `Closed Lost — ${current.name}`, tone: "lost" }
  else if (current?.kind === "PARKED") note = { label: `KIV — ${current.name}`, tone: "parked" }

  const steps: ProgressStep[] = ladder.map((s, i) => {
    let state: ProgressState = "upcoming"
    if (currentIdx >= 0) {
      if (i < currentIdx) state = "done"
      else if (i === currentIdx) state = current?.kind === "WON" ? "done" : "current"
    }
    return { id: s.id, label: s.name, state }
  })
  return { steps, note }
}

const LEAD_LADDER = ["new", "contacted", "qualified", "converted"] as const

/** Build the lead status ladder. Disqualified renders as a terminal note. */
export function buildLeadSteps(status: string): {
  steps: ProgressStep[]
  note: { label: string; tone: "lost" | "parked" } | null
} {
  const labels: Record<string, string> = {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    converted: "Converted",
  }
  const note =
    status === "disqualified"
      ? { label: "Disqualified", tone: "lost" as const }
      : null
  const currentIdx = LEAD_LADDER.indexOf(status as (typeof LEAD_LADDER)[number])
  const steps: ProgressStep[] = LEAD_LADDER.map((s, i) => {
    let state: ProgressState = "upcoming"
    if (currentIdx >= 0) {
      if (i < currentIdx) state = "done"
      else if (i === currentIdx) state = s === "converted" ? "done" : "current"
    }
    return { id: s, label: labels[s], state }
  })
  return { steps, note }
}
