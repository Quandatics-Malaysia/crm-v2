"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { formatDate, formatMoney } from "@/lib/format"
import { MILESTONE_STATUS_OPTIONS } from "@/lib/status-meta"
import { cn } from "@/lib/utils"
import type { ActionResult } from "@/lib/action-result"
import {
  createMilestone,
  deleteMilestone,
  reorderMilestones,
  updateMilestone,
  type MilestoneItem,
  type MilestoneStatus,
} from "../actions"

/**
 * Compact click-to-edit value (mirrors InlineRename, but renders a custom
 * `display` and supports number/date inputs). Enter/blur saves, Escape cancels.
 */
function InlineValue({
  value,
  display,
  type = "text",
  title,
  onSave,
  formatDraft,
  className,
  inputClassName,
}: {
  value: string
  display: React.ReactNode
  type?: "text" | "number" | "date"
  title?: string
  onSave: (next: string) => Promise<void> | void
  /** Format the in-flight draft for the optimistic display while saving. */
  formatDraft?: (next: string) => React.ReactNode
  className?: string
  inputClassName?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  // The committed draft kept on screen while the save is in flight, so the cell
  // shows the new value optimistically instead of flashing the stale one until
  // router.refresh() lands.
  const [optimistic, setOptimistic] = React.useState<string | null>(null)

  function start() {
    setDraft(value)
    setEditing(true)
  }
  async function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next === value.trim()) return
    setOptimistic(next)
    try {
      await onSave(next)
    } finally {
      // Fresh props from the refresh now reflect the saved value.
      setOptimistic(null)
    }
  }

  if (optimistic !== null) {
    return (
      <span
        aria-busy
        title="Saving…"
        className={cn("opacity-60", className)}
      >
        {formatDraft ? formatDraft(optimistic) : optimistic}
      </span>
    )
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? "0" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          if (type !== "date") e.currentTarget.select()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setEditing(false)
          }
        }}
        className={cn(
          "min-w-0 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring",
          inputClassName
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      title={title}
      className={cn(
        "text-left hover:underline decoration-dotted underline-offset-2",
        className
      )}
    >
      {display}
    </button>
  )
}

const STATUS_OPTIONS = MILESTONE_STATUS_OPTIONS as {
  value: MilestoneStatus
  label: string
}[]

export function MilestonesPanel({
  projectId,
  milestones,
  projectValue,
  currency,
  canManage = true,
}: {
  projectId: string
  milestones: MilestoneItem[]
  projectValue: string | null
  currency: string
  /** When false the panel is read-only: no inline edits, status changes,
   * reordering, deletes, or add-row (gated on project.update). */
  canManage?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  // Add-row form state. Milestones are split by EXACT amount (not percentage).
  const [title, setTitle] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")

  const value = projectValue ? Number(projectValue) : 0
  const hasValue = projectValue != null && projectValue !== ""
  const allocated = milestones.reduce(
    (sum, m) => sum + (Number(m.amount) || 0),
    0
  )
  const remaining = value - allocated

  function run(
    fn: () => Promise<ActionResult<unknown>>,
    success?: string
  ) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        toast.error(res.error)
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
    run(() => reorderMilestones(projectId, order), "Milestones reordered")
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Title is required")
      return
    }
    startTransition(async () => {
      const res = await createMilestone({
        projectId,
        title: title.trim(),
        amount: amount || null,
        dueDate: dueDate || null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setTitle("")
      setAmount("")
      setDueDate("")
      toast.success("Milestone added")
      router.refresh()
    })
  }

  return (
    <div className="grid gap-3">
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
                      save(() => updateMilestone(m.id, { title: next }))
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
                          updateMilestone(m.id, { dueDate: next || null })
                        )
                      }
                    />
                  ) : (
                    <span>{m.dueDate ? formatDate(m.dueDate) : "No due date"}</span>
                  )}
                </div>
              </div>

              {canManage ? (
                <InlineValue
                  value={m.amount ?? ""}
                  display={formatMoney(m.amount, currency)}
                  formatDraft={(v) => formatMoney(v || "0", currency)}
                  type="number"
                  title="Click to edit amount"
                  onSave={(next) =>
                    save(() => updateMilestone(m.id, { amount: next || null }))
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
                    () => updateMilestone(m.id, { status: String(next) }),
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
                          run(() => deleteMilestone(m.id), "Milestone deleted")
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
        className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      >
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
              <span className="text-xs">(net project value, ex-tax)</span>
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
    </div>
  )
}
