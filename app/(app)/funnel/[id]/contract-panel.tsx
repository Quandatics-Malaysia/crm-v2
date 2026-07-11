"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/status-badge"
import { formatMoney } from "@/lib/format"
import { showActionError } from "@/lib/show-action-error"
import type { ActionResult } from "@/lib/action-result"
import {
  createContractYear,
  deleteContractYear,
  updateContractYear,
  type ContractYearRow,
} from "../contract-actions"

const STATUS = [
  { value: "planned", label: "Planned" },
  { value: "invoiced", label: "Invoiced" },
  { value: "cancelled", label: "Cancelled" },
] as const

// Status pill: rendered by the app-wide <StatusBadge> tone map.

/**
 * Multi-year contract schedule. A multi-year deal is billed year by year; each
 * year's amount is REVISABLE (editable inline) and a year can be cancelled.
 * Cancelled years are excluded from the contract total.
 */
export function ContractPanel({
  funnelId,
  years,
  currency,
  canManage,
}: {
  funnelId: string
  years: ContractYearRow[]
  currency: string
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const [year, setYear] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [amount, setAmount] = React.useState("")

  const total = years
    .filter((y) => y.status !== "cancelled")
    .reduce((s, y) => s + Number(y.amount), 0)
  const invoiced = years
    .filter((y) => y.status === "invoiced")
    .reduce((s, y) => s + Number(y.amount), 0)

  function run(fn: () => Promise<ActionResult<unknown>>, ok?: string) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        showActionError(res)
        return
      }
      if (ok) toast.success(ok)
      router.refresh()
    })
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!year.trim()) {
      toast.error("Enter a year")
      return
    }
    run(
      () =>
        createContractYear(funnelId, {
          year: Number(year),
          title: title || null,
          amount: amount || "0",
        }),
      "Contract year added"
    )
    setYear("")
    setTitle("")
    setAmount("")
  }

  const columns: ColumnDef<ContractYearRow>[] = [
    {
      accessorKey: "year",
      header: "Year",
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{row.original.year}</span>
      ),
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.title ?? "—"}</span>
      ),
    },
    {
      accessorKey: "amount",
      header: `Amount (${currency})`,
      cell: ({ row }) => {
        const y = row.original
        return canManage ? (
          <Input
            key={y.id}
            type="number"
            step="0.01"
            min="0"
            defaultValue={Number(y.amount).toString()}
            disabled={pending || y.status === "cancelled"}
            onBlur={(e) => {
              const next = e.target.value
              if (Number(next) === Number(y.amount)) return
              run(
                () => updateContractYear(y.id, { amount: next || "0" }),
                "Amount updated"
              )
            }}
            className="h-8 w-32 text-right tabular-nums"
          />
        ) : (
          <span className="tabular-nums">{formatMoney(y.amount, y.currency)}</span>
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const y = row.original
        return canManage ? (
          <Select
            value={y.status}
            onValueChange={(v) =>
              run(
                () =>
                  updateContractYear(y.id, {
                    status: String(v) as "planned" | "invoiced" | "cancelled",
                  }),
                "Status updated"
              )
            }
            items={STATUS.map((s) => ({ value: s.value, label: s.label }))}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge status={y.status} />
        )
      },
    },
    ...(canManage
      ? ([
          {
            id: "actions",
            cell: ({ row }) => (
              <div className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label="Delete year"
                  onClick={() =>
                    run(() => deleteContractYear(row.original.id), "Year removed")
                  }
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ),
          },
        ] satisfies ColumnDef<ContractYearRow>[])
      : []),
  ]

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
        <Stat label="Years" value={String(years.filter((y) => y.status !== "cancelled").length)} />
        <Stat label="Contract total (ex-cancelled)" value={formatMoney(total, currency)} />
        <Stat label="Invoiced so far" value={formatMoney(invoiced, currency)} />
      </div>

      <DataTable
        columns={columns}
        data={years}
        tableId="funnel-contract"
        emptyMessage="No contract years yet."
        emptyDescription="Add one per billing year — prices stay editable and a year can be cancelled."
        pageSize={5}
      />

      {canManage ? (
        <form
          onSubmit={onAdd}
          className="grid items-end gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[6rem_1fr_8rem_auto]"
        >
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2024"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Y1 — License + AMS"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Amount</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="size-4" />
            Add year
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}
