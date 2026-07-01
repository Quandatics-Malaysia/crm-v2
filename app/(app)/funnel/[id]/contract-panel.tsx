"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/format"
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

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  planned: "secondary",
  invoiced: "default",
  cancelled: "destructive",
}

/**
 * Multi-year contract schedule. A multi-year deal is billed year by year; each
 * year's amount is REVISABLE (editable inline) and a year can be cancelled.
 * Cancelled years are excluded from the contract total.
 */
export function ContractPanel({
  opportunityId,
  years,
  currency,
  canManage,
}: {
  opportunityId: string
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

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong")
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
        createContractYear(opportunityId, {
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

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
        <Stat label="Years" value={String(years.filter((y) => y.status !== "cancelled").length)} />
        <Stat label="Contract total (ex-cancelled)" value={formatMoney(total, currency)} />
        <Stat label="Invoiced so far" value={formatMoney(invoiced, currency)} />
      </div>

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contract years yet. Add one per billing year — prices stay editable
          and a year can be cancelled.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Year</th>
                <th className="py-1.5 pr-2 font-medium">Title</th>
                <th className="py-1.5 pr-2 text-right font-medium">Amount ({currency})</th>
                <th className="py-1.5 pr-2 font-medium">Status</th>
                {canManage ? <th className="py-1.5" /> : null}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="border-b align-middle">
                  <td className="py-1.5 pr-2 font-medium tabular-nums">{y.year}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {y.title ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {canManage ? (
                      <Input
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
                      <span className="tabular-nums">
                        {formatMoney(y.amount, y.currency)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {canManage ? (
                      <Select
                        value={y.status}
                        onValueChange={(v) =>
                          run(
                            () =>
                              updateContractYear(y.id, {
                                status: String(v) as
                                  | "planned"
                                  | "invoiced"
                                  | "cancelled",
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
                      <Badge variant={statusVariant[y.status] ?? "secondary"}>
                        {y.status}
                      </Badge>
                    )}
                  </td>
                  {canManage ? (
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label="Delete year"
                        onClick={() =>
                          run(() => deleteContractYear(y.id), "Year removed")
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
