// The visual stepper was replaced by the shared chevron `StagePathView`
// (components/stage-path-view.tsx). This module now only builds the step model
// consumed by the lead detail's chevron path.
export type ProgressState = "done" | "current" | "upcoming" | "terminal"
export type ProgressStep = {
  id: string
  label: string
  state: ProgressState
  /** `won` colours the step green once reached (the success terminus). */
  tone?: "won"
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
    return {
      id: s.id,
      label: s.name,
      state,
      tone: s.kind === "WON" ? ("won" as const) : undefined,
    }
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
    return {
      id: s,
      label: labels[s],
      state,
      tone: s === "converted" ? ("won" as const) : undefined,
    }
  })
  return { steps, note }
}
