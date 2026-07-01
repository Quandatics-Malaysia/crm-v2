"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import { Card, CardContent } from "@/components/ui/card"
import { formatMoney, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FunnelWithStages } from "@/lib/lookups"
import { advanceStageAction, type OpportunityListRow } from "./actions"
import type { CustomFunnelField } from "@/lib/stage-gate"
import { StageAdvanceDialog } from "./stage-advance-dialog"
import { canTransition } from "./stage-transitions"

function kindAccent(kind: string): string {
  switch (kind) {
    case "WON":
      return "bg-emerald-500"
    case "LOST":
      return "bg-red-500"
    case "PARKED":
      return "bg-amber-500"
    default:
      return "bg-sky-500"
  }
}

type Stage = FunnelWithStages["stages"][number]

/** Inner content of an opportunity card — shared by the live card and the
 * drag overlay. */
function CardBody({ c }: { c: OpportunityListRow }) {
  return (
    <>
      <p className="truncate text-sm font-medium">{c.name}</p>
      <p className="truncate text-xs text-muted-foreground">{c.accountName}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-semibold tabular-nums">
          {(c.estimatedAmount ?? c.amount)
            ? formatMoney((c.estimatedAmount ?? c.amount)!, c.currency)
            : "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          {c.ownerName ?? ""}
        </span>
      </div>
    </>
  )
}

function DraggableCard({
  c,
  draggable,
}: {
  c: OpportunityListRow
  draggable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: c.id,
    data: { stageId: c.stageId },
    disabled: !draggable,
  })

  // Read-only users keep a navigable card but no drag handles attached.
  const dragProps = draggable ? { ...attributes, ...listeners } : {}

  return (
    <Card
      ref={draggable ? setNodeRef : undefined}
      className={cn(
        "gap-0 py-0 transition-colors hover:border-primary/50",
        isDragging && "opacity-40"
      )}
      {...dragProps}
    >
      <CardContent className="px-3 py-3">
        {/* The Link stays navigable: the PointerSensor only starts a drag
            after a small movement, so plain clicks open the deal. */}
        <Link href={`/funnel/${c.id}`} className="block">
          <span className="block [&_p:first-child]:hover:underline">
            <CardBody c={c} />
          </span>
        </Link>
      </CardContent>
    </Card>
  )
}

function StageColumn({
  stage,
  cards,
  draggable,
}: {
  stage: Stage
  cards: OpportunityListRow[]
  draggable: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { stageId: stage.id },
    disabled: !draggable,
  })
  const total = cards.reduce(
    (sum, c) => sum + Number(c.estimatedAmount ?? c.amount ?? 0),
    0
  )

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3 transition-colors",
        isOver && "bg-primary/10 ring-2 ring-primary/40"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", kindAccent(stage.kind))} />
          <span className="text-sm font-medium">{stage.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatPercent(stage.probability)}
          </span>
        </div>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {cards.length}
        </span>
      </div>

      <div className="text-xs text-muted-foreground tabular-nums">
        {formatMoney(String(total))}
      </div>

      <div className="flex min-h-2 flex-col gap-2">
        {cards.map((c) => (
          <DraggableCard key={c.id} c={c} draggable={draggable} />
        ))}
        {cards.length === 0 ? (
          <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            No funnels
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function OpportunitiesBoard({
  data,
  funnels,
  canAdvance,
  customFieldDefs = [],
}: {
  data: OpportunityListRow[]
  funnels: FunnelWithStages[]
  /** When false the board is read-only: cards aren't draggable and drops are
   * ignored, so a user without stage-advance can't move funnels. */
  canAdvance: boolean
  /** Tenant custom-field definitions, so a gated drop can collect required fields. */
  customFieldDefs?: CustomFunnelField[]
}) {
  const router = useRouter()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small drag before activating so card links remain clickable.
      activationConstraint: { distance: 6 },
    })
  )

  const [activeId, setActiveId] = React.useState<string | null>(null)
  // Controlled stage-advance dialog, opened when a drop targets a gated stage.
  const [gated, setGated] = React.useState<{
    opportunityId: string
    currentStageId: string
    targetStageId: string
  } | null>(null)

  // Optimistic card placement: on drop we move the card immediately and let
  // advanceStageAction() reconcile via router.refresh(). useOptimistic reverts
  // to `data` automatically when the transition settles, so a rejected move
  // (or one that only queued an approval) rolls back on its own.
  const [optimisticData, moveCard] = React.useOptimistic(
    data,
    (
      state: OpportunityListRow[],
      move: { id: string; targetStageId: string }
    ) =>
      state.map((o) =>
        o.id === move.id ? { ...o, stageId: move.targetStageId } : o
      )
  )

  const defaultFunnel =
    funnels.find((f) => f.isDefault) ?? funnels[0] ?? null

  const stages = React.useMemo(
    () =>
      defaultFunnel
        ? [...defaultFunnel.stages].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [defaultFunnel]
  )

  // Only show deals that live on this funnel, bucketed by stage.
  const byStage = React.useMemo(() => {
    const map = new Map<string, OpportunityListRow[]>()
    for (const s of stages) map.set(s.id, [])
    if (defaultFunnel) {
      for (const o of optimisticData) {
        if (o.funnelId !== defaultFunnel.id) continue
        const bucket = map.get(o.stageId)
        if (bucket) bucket.push(o)
      }
    }
    return map
  }, [stages, optimisticData, defaultFunnel])

  const activeCard = React.useMemo(
    () =>
      activeId ? optimisticData.find((o) => o.id === activeId) ?? null : null,
    [activeId, optimisticData]
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    // Fail-closed: ignore drops entirely for read-only users.
    if (!canAdvance) return
    const { active, over } = event
    if (!over) return

    const opportunityId = String(active.id)
    const targetStageId = String(over.id)
    const fromStageId = active.data.current?.stageId as string | undefined

    // Dropped on its own column — nothing to do.
    if (targetStageId === fromStageId) return

    const fromStage = stages.find((s) => s.id === fromStageId)
    const toStage = stages.find((s) => s.id === targetStageId)
    if (!fromStage || !toStage) return

    // Reject illegal moves up front so the board matches the server's rules.
    if (!canTransition(fromStage, toStage)) {
      toast.error("That stage move isn't allowed")
      return
    }

    // Approval-gated target: open the dialog so the user supplies a reason.
    // (A high-tier bypass user still moves immediately once they submit.)
    if (toStage.requiresApprovalToEnter) {
      setGated({
        opportunityId,
        currentStageId: fromStageId ?? "",
        targetStageId,
      })
      return
    }

    // Move the card now (optimistic), then advance on the server. On failure
    // we surface the error and the transition unwinds the optimistic move; on
    // success router.refresh() reconciles against the authoritative data.
    React.startTransition(async () => {
      moveCard({ id: opportunityId, targetStageId })
      const res = await advanceStageAction({ opportunityId, targetStageId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(res.data.moved ? "Moved" : "Sent for approval")
      router.refresh()
    })
  }

  if (!defaultFunnel) {
    return (
      <p className="text-sm text-muted-foreground">
        No funnel configured. Ask an admin to set one up.
      </p>
    )
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              cards={byStage.get(stage.id) ?? []}
              draggable={canAdvance}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <Card className="w-64 gap-0 border-primary/50 py-0 shadow-lg">
              <CardContent className="px-3 py-3">
                <CardBody c={activeCard} />
              </CardContent>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>

      {gated ? (
        <StageAdvanceDialog
          key={`${gated.opportunityId}-${gated.targetStageId}`}
          opportunityId={gated.opportunityId}
          currentStageId={gated.currentStageId}
          stages={stages}
          initialTargetStageId={gated.targetStageId}
          customFieldDefs={customFieldDefs}
          customValues={
            data.find((c) => c.id === gated.opportunityId)?.customFields ?? {}
          }
          open
          onOpenChange={(o) => {
            if (!o) setGated(null)
          }}
        />
      ) : null}
    </>
  )
}
