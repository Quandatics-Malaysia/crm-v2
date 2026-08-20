"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Plus, SplitIcon, Trash2 } from "lucide-react"
import { MilestoneSplitDialog } from "@/components/milestone-split-dialog"

import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate, formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { StatusBadge } from "@/components/status-badge"
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

  const value = valueCeiling ? Number(valueCeiling) : 0
  const hasValue = valueCeiling != null && valueCeiling !== ""
  const allocated = milestones.reduce(
    (sum, m) => sum + (Number(m.amount) || 0),
    0
  )
  const remaining = value - allocated

  // Chronological ("timely manner") view: sort by due date ascending, nulls
  // last. Ties (including both-null) fall back to sortOrder so the row order
  // stays stable. This is purely a render-order concern — the underlying
  // `milestones` prop/sortOrder is untouched; reordering (below) swaps rows
  // within this sorted view and persists that as the new sortOrder.
  const sortedMilestones = React.useMemo(() => {
    return [...milestones].sort((a, b) => {
      if (a.dueDate && b.dueDate) {
        if (a.dueDate < b.dueDate) return -1
        if (a.dueDate > b.dueDate) return 1
        return a.sortOrder - b.sortOrder
      }
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return a.sortOrder - b.sortOrder
    })
  }, [milestones])

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
    if (next < 0 || next >= sortedMilestones.length) return
    const order = sortedMilestones.map((m) => m.id)
    ;[order[index], order[next]] = [order[next], order[index]]
    run(() => onReorder(order), "Milestones reordered")
  }

  // Add a blank row (like appending a quote line item): create a milestone
  // with sensible defaults, then the user edits it inline via the row's cell
  // editors. Title is required by onCreate, so seed it non-empty.
  function onAdd() {
    startTransition(async () => {
      const res = await onCreate({
        title: "New milestone",
        description: null,
        amount: "0",
        dueDate: null,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
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
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Milestone</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? (
                  <TableHead className="w-28 text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMilestones.map((m, index) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {index + 1}
                  </TableCell>
                  <TableCell className="min-w-32 whitespace-normal">
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
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal text-xs text-muted-foreground">
                    {canManage ? (
                      <InlineValue
                        value={m.description ?? ""}
                        display={m.description || "Add description"}
                        title="Click to edit description"
                        onSave={(next) =>
                          save(() =>
                            onUpdate(m.id, { description: next || null })
                          )
                        }
                        className="text-xs text-muted-foreground"
                      />
                    ) : m.description ? (
                      <span>{m.description}</span>
                    ) : (
                      <span>—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
                  </TableCell>
                  <TableCell className="text-right">
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
                        className="justify-end text-sm font-semibold tabular-nums"
                        inputClassName="w-24 text-right tabular-nums"
                      />
                    ) : (
                      <span className="text-sm font-semibold tabular-nums">
                        {formatMoney(m.amount, currency)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
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
                          disabled={pending || index === sortedMilestones.length - 1}
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
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(allocated, currency)}
                </TableCell>
                <TableCell colSpan={canManage ? 2 : 1} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No milestones yet.</p>
      )}

      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={pending}
          onClick={onAdd}
        >
          <Plus className="size-4" />
          Add milestone
        </Button>
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
