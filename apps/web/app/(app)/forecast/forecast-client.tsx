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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatMoney, formatDate, formatMonth, formatPercent } from "@/lib/format"
import { ForecastCharts } from "./forecast-charts"
import type { ForecastRow, PipelineSummaryRow } from "./actions"

function monthLabel(value: string | null): string {
  const label = formatMonth(value)
  return label === "—" ? "Unscheduled" : label
}

const columns: ColumnDef<ForecastRow>[] = [
  {
    accessorKey: "opportunityName",
    header: ({ column }) => (
      <SortableHeader column={column} title="Funnel" />
    ),
    cell: ({ row }) => (
      <div className="grid gap-0.5">
        <span className="font-medium">{row.original.opportunityName}</span>
        {row.original.source === "inbound" ? (
          <span className="text-xs text-muted-foreground">
            via {row.original.originEntityName ?? "sibling entity"}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    id: "source",
    accessorFn: (r) => (r.source === "inbound" ? "Inbound" : "Own"),
    header: "Source",
    cell: ({ getValue }) => {
      const v = getValue<string>()
      return (
        <Badge variant={v === "Inbound" ? "outline" : "secondary"}>{v}</Badge>
      )
    },
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
  {
    id: "recognizedWeightedValue",
    accessorFn: (r) => Number(r.recognizedWeightedValue ?? 0),
    header: ({ column }) => (
      <SortableHeader column={column} title="Recognized" />
    ),
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex flex-col items-start">
          <span className="font-medium tabular-nums">
            {formatMoney(r.recognizedWeightedValue, r.currency ?? "MYR")}
          </span>
          {r.recognizedPercent != null ? (
            <span className="text-xs text-muted-foreground">
              {Number(r.recognizedPercent)}% cut
            </span>
          ) : null}
        </div>
      )
    },
  },
]

/** Fiscal year of a forecast month given the tenant's FY start month:
 *  months before the start belong to the PREVIOUS fiscal year. */
function fiscalYearOf(month: string, fyStartMonth: number): number {
  const d = new Date(month)
  const m = d.getMonth() + 1
  return m >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1
}

// ─── Time-frame filter ────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "this-month", label: "This month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "next-6m", label: "Next 6 months" },
  { value: "next-12m", label: "Next 12 months" },
  { value: "this-fy", label: "This fiscal year" },
  { value: "next-fy", label: "Next fiscal year" },
] as const

type PeriodPreset = (typeof PERIOD_OPTIONS)[number]["value"]

/** First day of a month, n months from now (local calendar). */
function monthStart(base: Date, offsetMonths: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + offsetMonths, 1)
}

/**
 * [from, to) month bounds for a preset, or null for "all". Fiscal-year presets
 * respect the tenant's FY start month.
 */
function periodBounds(
  preset: PeriodPreset,
  fyStartMonth: number,
  now: Date
): { from: Date; to: Date } | null {
  switch (preset) {
    case "all":
      return null
    case "this-month":
      return { from: monthStart(now, 0), to: monthStart(now, 1) }
    case "this-quarter": {
      const qStart = Math.floor(now.getMonth() / 3) * 3
      const from = new Date(now.getFullYear(), qStart, 1)
      return { from, to: new Date(now.getFullYear(), qStart + 3, 1) }
    }
    case "next-6m":
      return { from: monthStart(now, 0), to: monthStart(now, 6) }
    case "next-12m":
      return { from: monthStart(now, 0), to: monthStart(now, 12) }
    case "this-fy":
    case "next-fy": {
      const fyIndex = fyStartMonth - 1
      const startYear =
        now.getMonth() >= fyIndex ? now.getFullYear() : now.getFullYear() - 1
      const offset = preset === "next-fy" ? 1 : 0
      const from = new Date(startYear + offset, fyIndex, 1)
      return { from, to: new Date(startYear + offset + 1, fyIndex, 1) }
    }
  }
}

/**
 * Full forecast view: period selector + charts + totals + FY card + table,
 * all driven by ONE time-frame filter (rows without a forecast month only
 * appear under "All time").
 */
export function ForecastView({
  rows,
  pipeline,
  fiscalYearStartMonth = 1,
}: {
  rows: ForecastRow[]
  pipeline: PipelineSummaryRow[]
  fiscalYearStartMonth?: number
}) {
  const [period, setPeriod] = React.useState<PeriodPreset>("all")

  const filtered = React.useMemo(() => {
    const bounds = periodBounds(period, fiscalYearStartMonth, new Date())
    if (!bounds) return rows
    return rows.filter((r) => {
      if (!r.forecastMonth) return false
      const d = new Date(r.forecastMonth)
      return d >= bounds.from && d < bounds.to
    })
  }, [rows, period, fiscalYearStartMonth])

  const excluded = rows.length - filtered.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={period}
          onValueChange={(v) => setPeriod((v as PeriodPreset) ?? "all")}
          items={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period !== "all" ? (
          <span className="text-xs text-muted-foreground">
            {excluded} funnel{excluded === 1 ? "" : "s"} outside this period
            (incl. unscheduled) hidden.
          </span>
        ) : null}
      </div>

      <ForecastCharts rows={filtered} pipeline={pipeline} />
      <ForecastClient
        rows={filtered}
        fiscalYearStartMonth={fiscalYearStartMonth}
      />
    </div>
  )
}

export function ForecastClient({
  rows,
  fiscalYearStartMonth = 1,
}: {
  rows: ForecastRow[]
  fiscalYearStartMonth?: number
}) {
  // Aggregate per currency — opportunity currency is per-row, so summing across
  // currencies into a single MYR figure would be an implicit-FX error. Mirror
  // how v_pipeline_summary keeps one bucket per currency (no implicit FX).
  const byCurrency = React.useMemo(() => {
    const map = new Map<
      string,
      {
        currency: string
        opportunityValue: number
        weightedValue: number
        recognizedWeightedValue: number
        count: number
      }
    >()
    for (const r of rows) {
      const currency = r.currency ?? "MYR"
      const existing = map.get(currency) ?? {
        currency,
        opportunityValue: 0,
        weightedValue: 0,
        recognizedWeightedValue: 0,
        count: 0,
      }
      existing.opportunityValue += Number(r.opportunityValue ?? 0)
      existing.weightedValue += Number(r.weightedValue ?? 0)
      existing.recognizedWeightedValue += Number(r.recognizedWeightedValue ?? 0)
      existing.count += 1
      map.set(currency, existing)
    }
    return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
  }, [rows])

  // Fiscal-year totals (per currency, like everything else — no implicit FX).
  // Unscheduled rows (no forecast month) are excluded; the monthly table still
  // shows them.
  const byFiscalYear = React.useMemo(() => {
    const map = new Map<
      string,
      {
        key: string
        label: string
        currency: string
        weightedValue: number
        recognizedWeightedValue: number
      }
    >()
    for (const r of rows) {
      if (!r.forecastMonth) continue
      const currency = r.currency ?? "MYR"
      const fy = fiscalYearOf(r.forecastMonth, fiscalYearStartMonth)
      const label =
        fiscalYearStartMonth === 1 ? `FY${fy}` : `FY${fy}/${(fy + 1) % 100}`
      const key = `${currency}·${fy}`
      const existing = map.get(key) ?? {
        key,
        label,
        currency,
        weightedValue: 0,
        recognizedWeightedValue: 0,
      }
      existing.weightedValue += Number(r.weightedValue ?? 0)
      existing.recognizedWeightedValue += Number(r.recognizedWeightedValue ?? 0)
      map.set(key, existing)
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [rows, fiscalYearStartMonth])

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-muted/40">
        <CardHeader>
          <CardDescription>Forecast total</CardDescription>
          {byCurrency.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No forecast-eligible pipelines.
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
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {formatMoney(c.recognizedWeightedValue, c.currency)}{" "}
                    recognized
                    <span className="ml-1 text-xs">
                      (your entity&apos;s cut on intercompany deals)
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Stages included in the forecast are configured in Settings → Funnel
            Stages. Inbound rows are this entity&apos;s share of sibling
            entities&apos; intercompany deals.
          </p>
        </CardHeader>
      </Card>

      {byFiscalYear.length > 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>
              By fiscal year (starts month {fiscalYearStartMonth})
            </CardDescription>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {byFiscalYear.map((fy) => (
                <div key={fy.key}>
                  <CardDescription>
                    {fy.label} · {fy.currency}
                  </CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {formatMoney(fy.weightedValue, fy.currency)}
                  </CardTitle>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatMoney(fy.recognizedWeightedValue, fy.currency)}{" "}
                    recognized
                  </p>
                </div>
              ))}
            </div>
          </CardHeader>
        </Card>
      ) : null}
{/* 
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
            <CardDescription>Forecast-eligible pipelines</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{rows.length}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Funnels contributing to forecast
            </p>
          </CardHeader>
        </Card>
      </div> */}

      <DataTable
        columns={columns}
        data={rows}
        searchColumn="opportunityName"
        searchPlaceholder="Search pipelines…"
        facets={[{ columnId: "source", title: "Source" }]}
        emptyMessage="No forecast-eligible pipelines."
        pageSize={15}
      />
    </div>
  )
}
