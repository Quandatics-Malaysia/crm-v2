"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Plus, SplitIcon, Trash2 } from "lucide-react"
import { MilestoneSplitDialog } from "@/components/milestone-split-dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showActionError } from "@/lib/show-action-error"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { InlineRename } from "@/components/inline-rename"
import { InlineValue } from "@/components/inline-value"
import { formatDate, formatMoney } from "@/lib/format"
import { MILESTONE_STATUS_OPTIONS } from "@/lib/status-meta"
import { cn } from "@/lib/utils"
import type { ActionResult } from "@/lib/action-result"
import type { paymentMilestoneStatus } from "@/db/schema"

export type MilestoneStatus = (typeof paymentMilestoneStatus.enumValues)[number]

/** The subset of a milestone row this panel needs — satisfied by both the
 *  project-scoped MilestoneItem and the funnel-scoped PaymentMilestoneRow. */
export type MilestoneItemBase = {
  id: string
  title: string
  /** Optional user-facing notes. Undefined for milestone shapes that don't carry it yet. */
  description?: string | null
  amount: string | null
  dueDate: string | null
  status: MilestoneStatus
  sortOrder: number
}

export type MilestoneCreateValues = {
  title: string
  description?: string | null
  amount: string | null
  dueDate: string | null
}

export type MilestoneUpdateValues = {
  title?: string
  description?: string | null
  amount?: string | null
  dueDate?: string | null
  status?: string
}

const STATUS_OPTIONS = MILESTONE_STATUS_OPTIONS as {
  value: MilestoneStatus
  label: string
}[]

/**
 * Inline-editable payment milestone list + add-row form. Used for both
 * project-scoped milestones (app/(app)/projects/[id]/milestones-panel.tsx)
 * and funnel-scoped milestones (the funnel detail page's Payment Milestones
 * tab) — the parent supplies the create/update/delete/reorder callbacks
 * already bound to its own id, so this component stays entity-agnostic.
 */
export function MilestonesPanel({
  milestones,
  valueCeiling,
  valueCeilingLabel = "net value, ex-tax",
  currency,
  canManage = true,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onSplit,
}: {
  milestones: MilestoneItemBase[]
  /** The value the milestone amounts reconcile against (e.g. project/funnel net value), or null when unset. */
  valueCeiling: string | null
  /** Label for the ceiling in the footer, e.g. "net project value, ex-tax". */
  valueCeilingLabel?: string
  currency: string
  /** When false the panel is read-only: no inline edits, status changes,
   * reordering, deletes, or add-row (gated on the caller's manage permission). */
  canManage?: boolean
  onCreate: (values: MilestoneCreateValues) => Promise<ActionResult<unknown>>
  onUpdate: (id: string, values: MilestoneUpdateValues) => Promise<ActionResult<unknown>>
  onDelete: (id: string) => Promise<ActionResult<unknown>>
  onReorder: (order: string[]) => Promise<ActionResult<unknown>>
  /** When provided, offers a "Split payment" action — but only while the
   *  funnel is in its default, unsplit state (one milestone == the full
   *  value ceiling). Omit for callers that don't support splitting (e.g. the
   *  Project-scoped panel). */
  onSplit?: (parts: { title: string; amount: string }[]) => Promise<ActionResult<unknown>>
}) {
  const router = useRouter()
  const [splitOpen, setSplitOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  // Add-row form state. Milestones are split by EXACT amount (not percentage).
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")

  const value = valueCeiling ? Number(valueCeiling) : 0
  const hasValue = valueCeiling != null && valueCeiling !== ""
  const allocated = milestones.reduce(
    (sum, m) => sum + (Number(m.amount) || 0),
    0
  )
  const remaining = value - allocated

  // Splitting is only offered in the default, unsplit state — one milestone
  // whose amount exactly equals the value ceiling ("never make it splitable"
  // otherwise, since a split couldn't reconcile against a value that's
  // already diverged).
  const canSplit =
    !!onSplit &&
    hasValue &&
    value > 0 &&
    milestones.length === 1 &&
    Math.round((Number(milestones[0].amount) || 0) * 100) === Math.round(value * 100)

  function run(
    fn: () => Promise<ActionResult<unknown>>,
    success?: string
  ) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        showActionError(res)
        return
      }
      if (success) toast.success(success)
      router.refresh()
    })
  }

  /** Save via `run`, always resolving once the action settles (success or
   *  error, which `run` toasts) so inline editors never await a dead promise. */
  function save(fn: () => Promise<ActionResult<unknown>>) {
    return new Promise<void>((resolve) =>
      run(async () => {
        try {
          return await fn()
        } finally {
          resolve()
        }
      }, "Milestone updated")
    )
  }

  function move(index: number, dir: -1 | 1) {
    const next = index + dir
    if (next < 0 || next >= milestones.length) return
    const order = milestones.map((m) => m.id)
    ;[order[index], order[next]] = [order[next], order[index]]
    run(() => onReorder(order), "Milestones reordered")
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Title is required")
      return
    }
    startTransition(async () => {
      const res = await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        amount: amount || null,
        dueDate: dueDate || null,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      setTitle("")
      setDescription("")
      setAmount("")
      setDueDate("")
      toast.success("Milestone added")
      router.refresh()
    })
  }

  return (
    <div className="grid gap-3">
      {canSplit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setSplitOpen(true)}
        >
          <SplitIcon className="size-4" />
          Split payment
        </Button>
      ) : null}
      {milestones.length > 0 ? (
        <div className="grid gap-1">
          {milestones.map((m, index) => (
            <div
              key={m.id}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 sm:grid-cols-[1fr_auto_auto_auto]"
            >
              <div className="min-w-0">
                {canManage ? (
                  <InlineRename
                    value={m.title}
                    onSave={(next) =>
                      save(() => onUpdate(m.id, { title: next }))
                    }
                    className="text-sm font-medium"
                  />
                ) : (
                  <span className="text-sm font-medium">{m.title}</span>
                )}
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {canManage ? (
                    <InlineValue
                      value={m.dueDate ?? ""}
                      display={m.dueDate ? formatDate(m.dueDate) : "No due date"}
                      formatDraft={(v) => (v ? formatDate(v) : "No due date")}
                      type="date"
                      title="Click to edit due date"
                      onSave={(next) =>
                        save(() =>
                          onUpdate(m.id, { dueDate: next || null })
                        )
                      }
                    />
                  ) : (
                    <span>{m.dueDate ? formatDate(m.dueDate) : "No due date"}</span>
                  )}
                </div>
                {canManage ? (
                  <InlineValue
                    value={m.description ?? ""}
                    display={m.description || "Add description"}
                    title="Click to edit description"
                    onSave={(next) =>
                      save(() => onUpdate(m.id, { description: next || null }))
                    }
                    className="text-xs text-muted-foreground"
                  />
                ) : m.description ? (
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                ) : null}
              </div>

              {canManage ? (
                <InlineValue
                  value={m.amount ?? ""}
                  display={formatMoney(m.amount, currency)}
                  formatDraft={(v) => formatMoney(v || "0", currency)}
                  type="number"
                  title="Click to edit amount"
                  onSave={(next) =>
                    save(() => onUpdate(m.id, { amount: next || null }))
                  }
                  className="text-sm font-semibold tabular-nums"
                  inputClassName="w-24 text-right tabular-nums"
                />
              ) : (
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(m.amount, currency)}
                </span>
              )}

              <Select
                value={m.status}
                onValueChange={(next) =>
                  run(
                    () => onUpdate(m.id, { status: String(next) }),
                    "Milestone updated"
                  )
                }
                disabled={!canManage}
                items={STATUS_OPTIONS}
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o, i) => (
                    <SelectItem
                      key={o.value}
                      value={o.value}
                      // Forward-only: can't revert to an earlier status.
                      disabled={
                        i <
                        STATUS_OPTIONS.findIndex((s) => s.value === m.status)
                      }
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {canManage ? (
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || index === 0}
                  aria-label="Move milestone up"
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-4 text-muted-foreground" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || index === milestones.length - 1}
                  aria-label="Move milestone down"
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label="Delete milestone"
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this milestone?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{m.title}” ({formatMoney(m.amount, currency)}) will be
                        removed from the payment schedule. This can’t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() =>
                          run(() => onDelete(m.id), "Milestone deleted")
                        }
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No milestones yet.</p>
      )}

      {canManage ? (
      <form
        onSubmit={onAdd}
        className="grid gap-2 rounded-lg border border-dashed p-3"
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Deposit"
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
              className="sm:w-32"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="sm:w-40"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Description (optional)</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this milestone covers"
          />
        </div>
      </form>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        {hasValue ? (
          <>
            <span className="text-muted-foreground">
              Allocated{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(allocated, currency)}
              </span>{" "}
              of{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(value, currency)}
              </span>{" "}
              <span className="text-xs">({valueCeilingLabel})</span>
            </span>
            <span
              className={cn(
                "tabular-nums",
                remaining < 0
                  ? "text-destructive"
                  : remaining > 0
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-emerald-600 dark:text-emerald-500"
              )}
            >
              Remaining {formatMoney(remaining, currency)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Allocated{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatMoney(allocated, currency)}
            </span>
          </span>
        )}
      </div>

      {onSplit ? (
        <MilestoneSplitDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          targetAmount={value}
          currency={currency}
          onSplit={async (parts) => {
            const res = await onSplit(parts)
            if (res.ok) router.refresh()
            return res
          }}
        />
      ) : null}
    </div>
  )
}
