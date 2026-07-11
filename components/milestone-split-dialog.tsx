"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { showActionError } from "@/lib/show-action-error"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ActionResult } from "@/lib/action-result"

type Part = { title: string; amount: string }

/**
 * Guided split: break the current single "full amount" milestone into N
 * parts. Amounts must sum EXACTLY to `targetAmount` — the submit button
 * stays disabled until they do (mirrors the server's own exact-sum check in
 * `splitFunnelMilestones`, so there's no round trip just to find out it's
 * off by a cent).
 */
export function MilestoneSplitDialog({
  open,
  onOpenChange,
  targetAmount,
  currency,
  onSplit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetAmount: number
  currency: string
  onSplit: (
    parts: Part[]
  ) => Promise<ActionResult<unknown>>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split payment</DialogTitle>
          <DialogDescription>
            Break the {formatMoney(targetAmount, currency)} payment into parts.
            Amounts must add up exactly — nothing saves until they do.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted fresh each time the dialog opens, so its form state (parts,
            pending) always starts clean without an effect-based reset. */}
        {open ? (
          <SplitForm
            targetAmount={targetAmount}
            currency={currency}
            onSplit={onSplit}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SplitForm({
  targetAmount,
  currency,
  onSplit,
  onOpenChange,
}: {
  targetAmount: number
  currency: string
  onSplit: (parts: Part[]) => Promise<ActionResult<unknown>>
  onOpenChange: (open: boolean) => void
}) {
  const [parts, setParts] = React.useState<Part[]>([
    { title: "", amount: "" },
    { title: "", amount: "" },
  ])
  const [pending, setPending] = React.useState(false)

  const sum = parts.reduce((n, p) => n + (Number(p.amount) || 0), 0)
  const remaining = targetAmount - sum
  const matches = Math.round(remaining * 100) === 0

  function updatePart(i: number, patch: Partial<Part>) {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function addPart() {
    setParts((prev) => [...prev, { title: "", amount: "" }])
  }
  function removePart(i: number) {
    setParts((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!matches) return
    if (parts.some((p) => !p.title.trim())) {
      toast.error("Every part needs a title")
      return
    }
    setPending(true)
    const res = await onSplit(
      parts.map((p) => ({ title: p.title.trim(), amount: p.amount || "0" }))
    )
    setPending(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Payment split")
    onOpenChange(false)
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-2">
        {parts.map((p, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
          >
            <Input
              value={p.title}
              onChange={(e) => updatePart(i, { title: e.target.value })}
              placeholder={`Part ${i + 1}`}
              autoFocus={i === 0}
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              value={p.amount}
              onChange={(e) => updatePart(i, { amount: e.target.value })}
              placeholder="0.00"
              className="w-28 text-right tabular-nums"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={parts.length <= 2}
              onClick={() => removePart(i)}
              aria-label="Remove part"
            >
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addPart}
        className="justify-self-start"
      >
        <Plus className="size-4" />
        Add part
      </Button>
      <div
        className={cn(
          "flex items-center justify-between rounded-md border px-3 py-2 text-sm tabular-nums",
          matches
            ? "border-emerald-600/30 text-emerald-600 dark:text-emerald-500"
            : "border-amber-600/30 text-amber-600 dark:text-amber-500"
        )}
      >
        <span>Remaining</span>
        <span className="font-semibold">{formatMoney(remaining, currency)}</span>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!matches || pending}>
          Split into {parts.length} parts
        </Button>
      </DialogFooter>
    </form>
  )
}
