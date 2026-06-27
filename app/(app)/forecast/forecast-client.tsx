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
    header: ({ column }) => (
      <SortableHeader column={column} title="Funnel" />
    ),
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
  // Aggregate per currency — opportunity currency is per-row, so summing across
  // currencies into a single MYR figure would be an implicit-FX error. Mirror
  // how v_pipeline_summary keeps one bucket per currency (no implicit FX).
  const byCurrency = React.useMemo(() => {
    const map = new Map<
      string,
      { currency: string; opportunityValue: number; weightedValue: number; count: number }
    >()
    for (const r of rows) {
      const currency = r.currency ?? "MYR"
      const existing = map.get(currency) ?? {
        currency,
        opportunityValue: 0,
        weightedValue: 0,
        count: 0,
      }
      existing.opportunityValue += Number(r.opportunityValue ?? 0)
      existing.weightedValue += Number(r.weightedValue ?? 0)
      existing.count += 1
      map.set(currency, existing)
    }
    return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
  }, [rows])

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-muted/40">
        <CardHeader>
          <CardDescription>Forecast total</CardDescription>
          {byCurrency.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No forecast-eligible funnels.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {byCurrency.map((c) => (
                <div key={c.currency}>
                  <CardDescription>{c.currency}</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">
                    {formatMoney(c.weightedValue, c.currency)}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Weighted value · Σ value × stage probability
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {formatMoney(c.opportunityValue, c.currency)} funnel
                    value
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Stages included in the forecast are configured in Settings → Funnel
            Stages.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {byCurrency.map((c) => (
          <Card key={c.currency}>
            <CardHeader>
              <CardDescription>Weighted Forecast · {c.currency}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatMoney(c.weightedValue, c.currency)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {formatMoney(c.opportunityValue, c.currency)} funnel value ·{" "}
                {c.count} funnel{c.count === 1 ? "" : "s"}
              </p>
            </CardHeader>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardDescription>Forecast-eligible funnels</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{rows.length}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Funnels contributing to forecast
            </p>
          </CardHeader>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchColumn="opportunityName"
        searchPlaceholder="Search funnels…"
        emptyMessage="No forecast-eligible funnels."
        pageSize={15}
      />
    </div>
  )
}
