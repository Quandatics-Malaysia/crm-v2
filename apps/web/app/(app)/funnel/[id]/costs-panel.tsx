"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatMoney } from "@/lib/format"
import { showActionError } from "@/lib/show-action-error"
import type { ActionResult } from "@/lib/action-result"
import { cn } from "@/lib/utils"
import {
  createDealCost,
  deleteDealCost,
  type DealCostRow,
} from "../cost-actions"

const PARTY_KINDS = [
  { value: "supplier", label: "We → Supplier" },
  { value: "partner", label: "We → Partner" },
  { value: "partner_supplier", label: "Partner → Supplier" },
] as const

const partyLabel: Record<string, string> = {
  supplier: "We → Supplier",
  partner: "We → Partner",
  partner_supplier: "Partner → Supplier",
}

/**
 * Co-billing cost tracker: supplier + partner purchase orders (with FX) hung off
 * a deal, plus a revenue-vs-cost-vs-margin summary. "We → Supplier" and
 * "We → Partner" are the tenant's outlay (count toward margin); "Partner →
 * Supplier" is the partner's own cost (informational).
 */
export function CostsPanel({
  funnelId,
  costs,
  revenue,
  revenueLabel = "Quoted revenue",
  currency,
  currencies,
  canManage,
}: {
  funnelId: string
  costs: DealCostRow[]
  /** Revenue (base currency) margin is computed against — the deal's recognized
   *  cut for intercompany deals, else the quoted value. */
  revenue: number
  /** Label for the revenue stat (e.g. "Recognized revenue" for interco deals). */
  revenueLabel?: string
  currency: string
  /** Tenant currency picklist (Settings → General), for the cost-entry picker. */
  currencies: string[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const [partyKind, setPartyKind] = React.useState<string>("supplier")
  const [supplierName, setSupplierName] = React.useState("")
  const [poNumber, setPoNumber] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [year, setYear] = React.useState("")
  const [curr, setCurr] = React.useState(currency)
  const [amount, setAmount] = React.useState("")
  const [rate, setRate] = React.useState("1")

  const previewBase = (Number(amount || 0) * Number(rate || 1)).toFixed(2)

  // Include the deal's own currency even if it's fallen out of the tenant
  // picklist so a stale value stays selectable.
  const currencyItems = React.useMemo(() => {
    const items = [...currencies]
    if (curr && !items.includes(curr)) items.push(curr)
    return items
  }, [currencies, curr])

  // Tenant outlay = supplier + partner POs; partner_supplier is informational.
  const ourCost = costs
    .filter((c) => c.partyKind !== "partner_supplier")
    .reduce((s, c) => s + Number(c.amountBase), 0)
  const partnerCost = costs
    .filter((c) => c.partyKind === "partner_supplier")
    .reduce((s, c) => s + Number(c.amountBase), 0)
  const margin = revenue - ourCost
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0

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
    if (!supplierName.trim() && !poNumber.trim()) {
      toast.error("Add a supplier/payee or a PO number")
      return
    }
    run(
      () =>
        createDealCost(funnelId, {
          partyKind: partyKind as "supplier" | "partner" | "partner_supplier",
          supplierName: supplierName || null,
          poNumber: poNumber || null,
          category: category || null,
          contractYear: year ? Number(year) : null,
          currency: curr || currency,
          amount: amount || "0",
          exchangeRate: rate || "1",
        }),
      "Cost added"
    )
    setSupplierName("")
    setPoNumber("")
    setCategory("")
    setYear("")
    setAmount("")
    setRate("1")
    setCurr(currency)
  }

  const columns: ColumnDef<DealCostRow>[] = [
    {
      accessorKey: "supplierName",
      header: "PO / supplier",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.supplierName ?? "—"}</div>
          {row.original.poNumber ? (
            <div className="font-mono text-xs text-muted-foreground">
              {row.original.poNumber}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "partyKind",
      header: "Flow",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.partyKind === "partner_supplier" ? "outline" : "secondary"
          }
        >
          {partyLabel[row.original.partyKind] ?? row.original.partyKind}
        </Badge>
      ),
    },
    {
      accessorKey: "category",
      header: "Category / yr",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.category ?? "—"}
          {row.original.contractYear ? ` · ${row.original.contractYear}` : ""}
        </span>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.amount, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "exchangeRate",
      header: "Rate",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {Number(row.original.exchangeRate) === 1
            ? "—"
            : Number(row.original.exchangeRate).toFixed(4)}
        </span>
      ),
    },
    {
      accessorKey: "amountBase",
      header: currency,
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">
          {formatMoney(row.original.amountBase, currency)}
        </span>
      ),
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
                  aria-label="Delete cost"
                  onClick={() =>
                    run(() => deleteDealCost(row.original.id), "Cost deleted")
                  }
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ),
          },
        ] satisfies ColumnDef<DealCostRow>[])
      : []),
  ]

  return (
    <div className="grid gap-4">
      {/* Margin summary */}
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
        <Stat label={revenueLabel} value={formatMoney(revenue, currency)} />
        <Stat label="Our cost" value={formatMoney(ourCost, currency)} />
        <Stat
          label="Margin"
          value={formatMoney(margin, currency)}
          tone={margin < 0 ? "bad" : margin > 0 ? "good" : undefined}
        />
        <Stat
          label="Margin %"
          value={`${marginPct.toFixed(1)}%`}
          tone={margin < 0 ? "bad" : margin > 0 ? "good" : undefined}
        />
      </div>
      {partnerCost > 0 ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Partner&apos;s own supplier cost (informational):{" "}
          {formatMoney(partnerCost, currency)}
        </p>
      ) : null}

      {/* Cost lines */}
      <DataTable
        columns={columns}
        data={costs}
        tableId="funnel-costs"
        searchColumn="supplierName"
        searchPlaceholder="Search costs…"
        emptyMessage="No cost lines yet."
        pageSize={5}
      />

      {/* Add form */}
      {canManage ? (
        <form
          onSubmit={onAdd}
          className="grid gap-2 rounded-lg border border-dashed p-3"
        >
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Flow</label>
              <Select
                value={partyKind}
                onValueChange={(v) => setPartyKind(String(v))}
                items={PARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTY_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Supplier / payee</label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Gitlab"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">PO number</label>
              <Input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="QMPO-22068"
              />
            </div>
            <div className="grid gap-1 sm:grid-cols-2 sm:gap-2">
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Category</label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="License"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Year</label>
                <Input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2024"
                />
              </div>
            </div>
          </div>
          <div className="grid items-end gap-2 sm:grid-cols-[5rem_1fr_1fr_auto_auto]">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Currency</label>
              <Select
                value={curr}
                onValueChange={(v) => setCurr(String(v))}
                items={currencyItems.map((c) => ({ value: c, label: c }))}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyItems.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Ex. rate → {currency}</label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">= {currency}</label>
              <div className="flex h-9 items-center text-sm tabular-nums text-muted-foreground">
                {formatMoney(previewBase, currency)}
              </div>
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "good" | "bad"
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-emerald-600 dark:text-emerald-500"
        )}
      >
        {value}
      </span>
    </div>
  )
}
