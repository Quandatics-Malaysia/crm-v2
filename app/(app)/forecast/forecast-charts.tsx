"use client"

import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatMoney } from "@/lib/format"
import type { ForecastRow, PipelineSummaryRow } from "./actions"

const MONTH_FMT = new Intl.DateTimeFormat("en-MY", {
  month: "short",
  year: "numeric",
})

function monthLabel(value: string | null): string {
  if (!value) return "Unscheduled"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "Unscheduled"
  return MONTH_FMT.format(d)
}

/** Compact RM label for chart axes (e.g. RM 12.5k, RM 1.2M). */
function compactMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `RM ${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `RM ${(value / 1_000).toFixed(1)}k`
  return `RM ${Math.round(value)}`
}

const weightedConfig = {
  weightedValue: {
    label: "Weighted",
    color: "var(--primary)",
  },
} satisfies ChartConfig

const stageConfig = {
  weightedAmount: {
    label: "Weighted",
    color: "var(--primary)",
  },
} satisfies ChartConfig

export function ForecastCharts({
  rows,
  pipeline,
}: {
  rows: ForecastRow[]
  pipeline: PipelineSummaryRow[]
}) {
  // Chart 1 — weighted forecast grouped by forecast_month.
  const byMonth = React.useMemo(() => {
    const map = new Map<
      string,
      { sortKey: string; month: string; weightedValue: number }
    >()
    for (const r of rows) {
      const sortKey = r.forecastMonth ?? "~~~" // push unscheduled to the end
      const existing = map.get(sortKey) ?? {
        sortKey,
        month: monthLabel(r.forecastMonth),
        weightedValue: 0,
      }
      existing.weightedValue += Number(r.weightedValue ?? 0)
      map.set(sortKey, existing)
    }
    return [...map.values()].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey)
    )
  }, [rows])

  // Chart 2 — pipeline weighted amount per stage, ordered by sort_order.
  // Aggregate across funnels that share a stage name.
  const byStage = React.useMemo(() => {
    const map = new Map<
      string,
      {
        sortOrder: number
        stage: string
        weightedAmount: number
        opportunityCount: number
      }
    >()
    for (const p of pipeline) {
      const key = p.stageName ?? p.stageCode ?? "—"
      const existing = map.get(key) ?? {
        sortOrder: p.sortOrder,
        stage: p.stageName ?? p.stageCode ?? "—",
        weightedAmount: 0,
        opportunityCount: 0,
      }
      existing.weightedAmount += Number(p.weightedAmount ?? 0)
      existing.opportunityCount += Number(p.opportunityCount ?? 0)
      // keep the lowest sort_order seen for a stable position
      existing.sortOrder = Math.min(existing.sortOrder, p.sortOrder)
      map.set(key, existing)
    }
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [pipeline])

  const hasMonths = byMonth.length > 0
  const hasStages = byStage.length > 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>By expected month</CardDescription>
          <CardTitle>Weighted forecast</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          {hasMonths ? (
            <ChartContainer
              config={weightedConfig}
              className="aspect-auto h-[260px] w-full"
            >
              <BarChart data={byMonth} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={16}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => compactMoney(Number(v))}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      formatter={(value) => (
                        <span className="font-mono font-medium tabular-nums">
                          {formatMoney(Number(value))}
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="weightedValue"
                  fill="var(--color-weightedValue)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No scheduled forecast to chart.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>By stage · ordered by funnel sequence</CardDescription>
          <CardTitle>Pipeline weighted amount</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          {hasStages ? (
            <ChartContainer
              config={stageConfig}
              className="aspect-auto h-[260px] w-full"
            >
              <BarChart data={byStage} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="stage"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={4}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => compactMoney(Number(v))}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="dot"
                      formatter={(value, _name, item) => (
                        <div className="flex flex-1 justify-between gap-3 leading-none">
                          <span className="text-muted-foreground">
                            {item?.payload?.opportunityCount ?? 0} open
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {formatMoney(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="weightedAmount"
                  fill="var(--color-weightedAmount)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No pipeline stages to chart.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
