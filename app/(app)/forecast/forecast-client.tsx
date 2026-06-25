"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMoney, formatDate, formatPercent } from "@/lib/format"
import type { ForecastRow } from "./actions"

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

const columns: ColumnDef<ForecastRow>[] = [
  {
    accessorKey: "opportunityName",
    header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.opportunityName}</span>
    ),
  },
  {
    id: "stage",
    accessorFn: (r) => r.stageName ?? "",
    header: "Stage",
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex items-center gap-2">
          <span>{r.stageName ?? "—"}</span>
          {r.probability != null ? (
            <Badge variant="secondary">{formatPercent(r.probability)}</Badge>
          ) : null}
        </div>
      )
    },
  },
  {
    id: "forecastMonth",
    accessorFn: (r) => r.forecastMonth ?? "",
    header: ({ column }) => <SortableHeader column={column} title="Expected" />,
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex flex-col">
          <span>{monthLabel(r.forecastMonth)}</span>
          {r.expectedCloseDate ? (
            <span className="text-xs text-muted-foreground">
              {formatDate(r.expectedCloseDate)}
            </span>
          ) : null}
        </div>
      )
    },
  },
  {
    id: "opportunityValue",
    accessorFn: (r) => Number(r.opportunityValue ?? 0),
    header: ({ column }) => (
      <SortableHeader column={column} title="Value" />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatMoney(row.original.opportunityValue, row.original.currency ?? "MYR")}
      </span>
    ),
  },
  {
    id: "weightedValue",
    accessorFn: (r) => Number(r.weightedValue ?? 0),
    header: ({ column }) => (
      <SortableHeader column={column} title="Weighted" />
    ),
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {formatMoney(row.original.weightedValue, row.original.currency ?? "MYR")}
      </span>
    ),
  },
]

export function ForecastClient({ rows }: { rows: ForecastRow[] }) {
  const totals = React.useMemo(() => {
    let opportunityValue = 0
    let weightedValue = 0
    for (const r of rows) {
      opportunityValue += Number(r.opportunityValue ?? 0)
      weightedValue += Number(r.weightedValue ?? 0)
    }
    return { opportunityValue, weightedValue, openCount: rows.length }
  }, [rows])

  const byMonth = React.useMemo(() => {
    const map = new Map<
      string,
      { label: string; opportunityValue: number; weightedValue: number; count: number }
    >()
    for (const r of rows) {
      const key = r.forecastMonth ?? "__none__"
      const existing = map.get(key) ?? {
        label: monthLabel(r.forecastMonth),
        opportunityValue: 0,
        weightedValue: 0,
        count: 0,
      }
      existing.opportunityValue += Number(r.opportunityValue ?? 0)
      existing.weightedValue += Number(r.weightedValue ?? 0)
      existing.count += 1
      map.set(key, existing)
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === "__none__") return 1
        if (b === "__none__") return -1
        return a.localeCompare(b)
      })
      .map(([, v]) => v)
  }, [rows])

  const cards = [
    {
      title: "Weighted Forecast",
      value: formatMoney(totals.weightedValue),
      desc: "Σ value × stage probability",
    },
    {
      title: "Open Pipeline Value",
      value: formatMoney(totals.opportunityValue),
      desc: "Σ net-of-tax funnel value",
    },
    {
      title: "Open Funnels",
      value: String(totals.openCount),
      desc: "Deals contributing to forecast",
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-muted/40">
        <CardHeader>
          <CardDescription>Forecast total</CardDescription>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <CardTitle className="text-3xl tabular-nums">
                {formatMoney(totals.weightedValue)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Total weighted value · Σ value × stage probability
              </p>
            </div>
            <div>
              <CardTitle className="text-3xl tabular-nums">
                {formatMoney(totals.opportunityValue)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Total opportunity value · Σ net-of-tax funnel value
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Stages included in the forecast are configured in Settings → Funnel
            Stages.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardDescription>{c.title}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{c.value}</CardTitle>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      {byMonth.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {byMonth.map((m) => (
            <Card key={m.label} size="sm">
              <CardHeader>
                <CardDescription>{m.label}</CardDescription>
                <CardTitle className="text-lg tabular-nums">
                  {formatMoney(m.weightedValue)}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {m.count} deal{m.count === 1 ? "" : "s"} ·{" "}
                  {formatMoney(m.opportunityValue)} gross
                </p>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={rows}
        searchColumn="opportunityName"
        searchPlaceholder="Search funnels…"
        emptyMessage="No open funnels to forecast."
        pageSize={15}
      />
    </div>
  )
}
