"use client"

import * as React from "react"

import {
  StagePathView,
  type PathStep,
  type PathNote,
} from "@/components/stage-path-view"

type Stage = {
  id: string
  code: string
  name: string
  kind: string
  probability: string
  sortOrder: number
  requiresApprovalToEnter: boolean
  requiredFields: string[]
}

/**
 * Funnel stage path. Builds the OPEN→WON ladder into chevron steps and lets the
 * detail panel inspect any stage. Stage movement remains owned by the page-level
 * transition dialog, so selecting a stage never mutates the Funnel.
 */
export function StagePath({
  currentStageId,
  stages,
  onStageSelect,
}: {
  currentStageId: string
  stages: Stage[]
  onStageSelect?: (id: string) => void
}) {
  const { steps, note } = React.useMemo(() => {
    const ladder = stages
      .filter((s) => s.kind === "OPEN" || s.kind === "WON")
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const currentIdx = ladder.findIndex((s) => s.id === currentStageId)
    const current = stages.find((s) => s.id === currentStageId)
    const steps: PathStep[] = ladder.map((s, i) => {
      const state =
        currentIdx >= 0 && i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "upcoming"
      return {
        id: s.id,
        label: s.name,
        state,
        tone: s.kind === "WON" ? "won" : "default",
        clickable: !!onStageSelect,
        title: onStageSelect ? `View ${s.name} fields` : undefined,
      }
    })

    let note: PathNote = null
    if (current?.kind === "LOST")
      note = { label: `Closed Lost — ${current.name}`, tone: "lost" }
    else if (current?.kind === "PARKED")
      note = { label: `KIV — ${current.name}`, tone: "parked" }

    return { steps, note }
  }, [stages, currentStageId, onStageSelect])

  return (
    <>
      <StagePathView
        steps={steps}
        note={note}
        onStepSelect={onStageSelect}
      />
    </>
  )
}
