"use client"

import * as React from "react"

import {
  StagePathView,
  type PathStep,
  type PathNote,
} from "@/components/stage-path-view"
import type { StageGate, CustomFunnelField } from "@/lib/stage-gate"
import type { PpvvcPatch } from "@/lib/ppvvc"
import { StageAdvanceDialog } from "./stage-advance-dialog"
import { selectableTargets } from "./stage-transitions"

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
 * Funnel stage path. Builds the OPEN→WON ladder into chevron steps and renders
 * the shared {@link StagePathView}; clicking a legal next stage opens the
 * StageAdvanceDialog pre-seeded with that target (approval-gated and terminal
 * moves still run through the same confirmation/approval flow). A Lost/KIV
 * current stage sits off the ladder and shows as a coloured note.
 */
export function StagePath({
  funnelId,
  currentStageId,
  stages,
  interactive,
  gate,
  customFieldDefs = [],
  customValues = {},
  ppvvc,
  canEditPpvvc = false,
}: {
  funnelId: string
  currentStageId: string
  stages: Stage[]
  /** When false, the path is read-only (terminal deal, pending approval, or no permission). */
  interactive: boolean
  /** Resolved per-stage entry gate (preset + custom field completeness). */
  gate?: StageGate
  /** Tenant custom-field definitions, so advancing can collect required fields. */
  customFieldDefs?: CustomFunnelField[]
  /** The funnel's current custom-field values. */
  customValues?: Record<string, string>
  /** Authoritative Opportunity PPVVC values for inline stage editing. */
  ppvvc?: PpvvcPatch | null
  canEditPpvvc?: boolean
}) {
  const [target, setTarget] = React.useState<string | null>(null)

  const { steps, note } = React.useMemo(() => {
    const ladder = stages
      .filter((s) => s.kind === "OPEN" || s.kind === "WON")
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const currentIdx = ladder.findIndex((s) => s.id === currentStageId)
    const selectableIds = new Set(
      selectableTargets(stages, currentStageId).map((s) => s.id)
    )
    const steps: PathStep[] = ladder.map((s, i) => {
      const state =
        currentIdx >= 0 && i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "upcoming"
      const clickable = interactive && selectableIds.has(s.id)
      return {
        id: s.id,
        label: s.name,
        state,
        tone: s.kind === "WON" ? "won" : "default",
        clickable,
        title: clickable ? `Advance to ${s.name}` : undefined,
      }
    })

    const current = stages.find((s) => s.id === currentStageId)
    let note: PathNote = null
    if (current?.kind === "LOST")
      note = { label: `Closed Lost — ${current.name}`, tone: "lost" }
    else if (current?.kind === "PARKED")
      note = { label: `KIV — ${current.name}`, tone: "parked" }

    return { steps, note }
  }, [stages, currentStageId, interactive])

  return (
    <>
      <StagePathView
        steps={steps}
        note={note}
        hint={interactive && !note ? "Click a later stage to advance." : undefined}
        onStepClick={interactive ? setTarget : undefined}
      />
      {interactive ? (
        // Keyed by target so each click remounts the dialog with a fresh seed.
        <StageAdvanceDialog
          key={target ?? "none"}
          funnelId={funnelId}
          currentStageId={currentStageId}
          stages={stages}
          open={target !== null}
          onOpenChange={(o) => {
            if (!o) setTarget(null)
          }}
          initialTargetStageId={target ?? undefined}
          gate={gate}
          customFieldDefs={customFieldDefs}
          customValues={customValues}
          ppvvc={ppvvc}
          canEditPpvvc={canEditPpvvc}
        />
      ) : null}
    </>
  )
}
