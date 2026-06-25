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
import { StageAdvanceDialog } from "./stage-advance-dialog"

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
          {c.amount ? formatMoney(c.amount, c.currency) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          {c.ownerName ?? ""}
        </span>
      </div>
    </>
  )
}

function DraggableCard({ c }: { c: OpportunityListRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: c.id,
    data: { stageId: c.stageId },
  })

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "gap-0 py-0 transition-colors hover:border-primary/50",
        isDragging && "opacity-40"
      )}
      {...attributes}
      {...listeners}
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
}: {
  stage: Stage
  cards: OpportunityListRow[]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { stageId: stage.id },
  })
  const total = cards.reduce((sum, c) => sum + Number(c.amount ?? 0), 0)

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
          <DraggableCard key={c.id} c={c} />
        ))}
        {cards.length === 0 ? (
          <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            No deals
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function OpportunitiesBoard({
  data,
  funnels,
}: {
  data: OpportunityListRow[]
  funnels: FunnelWithStages[]
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
      for (const o of data) {
        if (o.funnelId !== defaultFunnel.id) continue
        const bucket = map.get(o.stageId)
        if (bucket) bucket.push(o)
      }
    }
    return map
  }, [stages, data, defaultFunnel])

  const activeCard = React.useMemo(
    () => (activeId ? data.find((o) => o.id === activeId) ?? null : null),
    [activeId, data]
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const opportunityId = String(active.id)
    const targetStageId = String(over.id)
    const fromStageId = active.data.current?.stageId as string | undefined

    // Dropped on its own column — nothing to do.
    if (targetStageId === fromStageId) return
    if (!stages.some((s) => s.id === targetStageId)) return

    try {
      const result = await advanceStageAction({ opportunityId, targetStageId })
      if (result.moved) {
        toast.success("Moved")
        router.refresh()
      } else {
        // Service returned without moving (e.g. routed to approval already).
        toast.success("Sent for approval")
        router.refresh()
      }
    } catch {
      // Gated stage: a reason is required. Open the stage-advance dialog
      // pre-set to this opportunity and target so the user supplies one.
      setGated({
        opportunityId,
        currentStageId: fromStageId ?? "",
        targetStageId,
      })
    }
  }

  if (!defaultFunnel) {
    return (
      <p className="text-sm text-muted-foreground">
        No funnel configured. Ask an admin to set up a pipeline.
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
          open
          onOpenChange={(o) => {
            if (!o) setGated(null)
          }}
        />
      ) : null}
    </>
  )
}
