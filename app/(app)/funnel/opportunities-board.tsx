"use client"

import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import { formatMoney, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FunnelWithStages } from "@/lib/lookups"
import type { OpportunityListRow } from "./actions"

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

export function OpportunitiesBoard({
  data,
  funnels,
}: {
  data: OpportunityListRow[]
  funnels: FunnelWithStages[]
}) {
  const defaultFunnel = funnels.find((f) => f.isDefault) ?? funnels[0] ?? null

  if (!defaultFunnel) {
    return (
      <p className="text-sm text-muted-foreground">
        No funnel configured. Ask an admin to set up a pipeline.
      </p>
    )
  }

  const stages = [...defaultFunnel.stages].sort(
    (a, b) => a.sortOrder - b.sortOrder
  )

  // Only show deals that live on this funnel.
  const byStage = new Map<string, OpportunityListRow[]>()
  for (const s of stages) byStage.set(s.id, [])
  for (const o of data) {
    if (o.funnelId !== defaultFunnel.id) continue
    const bucket = byStage.get(o.stageId)
    if (bucket) bucket.push(o)
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {stages.map((stage) => {
        const cards = byStage.get(stage.id) ?? []
        const total = cards.reduce((sum, c) => sum + Number(c.amount ?? 0), 0)
        return (
          <div
            key={stage.id}
            className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn("size-2 rounded-full", kindAccent(stage.kind))}
                />
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

            <div className="flex flex-col gap-2">
              {cards.map((c) => (
                <Card
                  key={c.id}
                  className="gap-0 py-0 transition-colors hover:border-primary/50"
                >
                  <CardContent className="px-3 py-3">
                    <Link
                      href={`/funnel/${c.id}`}
                      className="block"
                    >
                      <p className="truncate text-sm font-medium hover:underline">
                        {c.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.accountName}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold tabular-nums">
                          {c.amount
                            ? formatMoney(c.amount, c.currency)
                            : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.ownerName ?? ""}
                        </span>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              ))}
              {cards.length === 0 ? (
                <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                  No deals
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
