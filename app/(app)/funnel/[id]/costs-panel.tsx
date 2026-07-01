"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"

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
  opportunityId,
  costs,
  revenue,
  currency,
  canManage,
}: {
  opportunityId: string
  costs: DealCostRow[]
  /** Quoted revenue (base currency) to compute margin against. */
  revenue: number
  currency: string
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

  // Tenant outlay = supplier + partner POs; partner_supplier is informational.
  const ourCost = costs
    .filter((c) => c.partyKind !== "partner_supplier")
    .reduce((s, c) => s + Number(c.amountBase), 0)
  const partnerCost = costs
    .filter((c) => c.partyKind === "partner_supplier")
    .reduce((s, c) => s + Number(c.amountBase), 0)
  const margin = revenue - ourCost
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0

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
    if (!supplierName.trim() && !poNumber.trim()) {
      toast.error("Add a supplier/payee or a PO number")
      return
    }
    run(
      () =>
        createDealCost(opportunityId, {
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

  return (
    <div className="grid gap-4">
      {/* Margin summary */}
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
        <Stat label="Quoted revenue" value={formatMoney(revenue, currency)} />
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
      {costs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cost lines yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">PO / supplier</th>
                <th className="py-1.5 pr-2 font-medium">Flow</th>
                <th className="py-1.5 pr-2 font-medium">Category / yr</th>
                <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
                <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
                <th className="py-1.5 pr-2 text-right font-medium">{currency}</th>
                {canManage ? <th className="py-1.5" /> : null}
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id} className="border-b align-top">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{c.supplierName ?? "—"}</div>
                    {c.poNumber ? (
                      <div className="font-mono text-xs text-muted-foreground">
                        {c.poNumber}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Badge
                      variant={
                        c.partyKind === "partner_supplier" ? "outline" : "secondary"
                      }
                    >
                      {partyLabel[c.partyKind] ?? c.partyKind}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {c.category ?? "—"}
                    {c.contractYear ? ` · ${c.contractYear}` : ""}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatMoney(c.amount, c.currency)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {Number(c.exchangeRate) === 1
                      ? "—"
                      : Number(c.exchangeRate).toFixed(4)}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                    {formatMoney(c.amountBase, currency)}
                  </td>
                  {canManage ? (
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label="Delete cost"
                        onClick={() =>
                          run(() => deleteDealCost(c.id), "Cost deleted")
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
              <Input
                value={curr}
                onChange={(e) => setCurr(e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
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
