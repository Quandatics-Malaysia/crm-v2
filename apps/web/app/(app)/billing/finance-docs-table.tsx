"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileStackIcon, PlusIcon } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { showActionError } from "@/lib/show-action-error"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { formatDate, formatMoney } from "@/lib/format"
import { toDateString } from "@/lib/dates"
import { daysOverdue, reminderStageDue } from "@/lib/reminders"
import {
  FINANCE_KINDS,
  kindsForDirection,
  type FinanceDocKind,
} from "@/lib/finance-kinds"
import {
  createFinanceDoc,
  setFinanceDocStatus,
  type FinanceDocRow,
  type FinanceSources,
} from "./actions"

const NONE = "__none__"

/** Child kinds that may be created FROM a document of `kind`. */
function childKinds(kind: FinanceDocKind): FinanceDocKind[] {
  return (Object.keys(FINANCE_KINDS) as FinanceDocKind[]).filter((k) =>
    FINANCE_KINDS[k].parents.includes(kind)
  )
}

export function CreateDocDialog({
  direction,
  sources,
  preset,
  onOpenChange,
}: {
  direction: "sale" | "purchase"
  sources: FinanceSources
  /** Prefill when creating the next document from an existing row. */
  preset?: { kind: FinanceDocKind; parent: FinanceDocRow }
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const kinds = preset ? [preset.kind] : kindsForDirection(direction)
  const [kind, setKind] = React.useState<FinanceDocKind>(preset?.kind ?? kinds[0])
  const [salesOrderId, setSalesOrderId] = React.useState("")
  const [parentId, setParentId] = React.useState(preset?.parent.id ?? "")
  const [milestoneId, setMilestoneId] = React.useState("")
  const [partyName, setPartyName] = React.useState(preset?.parent.partyName ?? "")
  const [amount, setAmount] = React.useState(preset?.parent.amount ?? "")
  const [docDate, setDocDate] = React.useState(() => toDateString(new Date()))
  const [dueDate, setDueDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const meta = FINANCE_KINDS[kind]
  const soOptions = sources.salesOrders.map((s) => ({
    value: s.id,
    label: `${s.soNumber} · ${s.projectName ?? "—"}`,
  }))
  const parentOptions = sources.docs
    .filter((d) => meta.parents.includes(d.kind))
    .map((d) => ({ value: d.id, label: `${d.number} · ${FINANCE_KINDS[d.kind].label}` }))

  // Milestones for the chosen SO's project (invoice tie).
  const soProjectId = sources.salesOrders.find((s) => s.id === salesOrderId)?.projectId
  const milestoneOptions =
    kind === "invoice" && soProjectId
      ? sources.milestones
          .filter((m) => m.projectId === soProjectId)
          .map((m) => ({ value: m.id, label: `${m.title} · ${m.amount}` }))
      : []

  function onKindChange(next: FinanceDocKind) {
    setKind(next)
    setParentId("")
    setMilestoneId("")
    // A hidden stale SO would otherwise override the parent's real chain root.
    setSalesOrderId("")
  }

  async function submit() {
    setBusy(true)
    try {
      const res = await createFinanceDoc({
        kind,
        salesOrderId: salesOrderId || null,
        parentId: parentId || null,
        milestoneId: milestoneId || null,
        partyName: partyName || null,
        amount: amount || "0",
        docDate: docDate || null,
        dueDate: dueDate || null,
        notes: notes || null,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success(`${meta.label} ${res.data.number} created (draft)`)
      onOpenChange(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {preset ? `New ${meta.label.toLowerCase()} from ${preset.parent.number}` : "New document"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {!preset ? (
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => onKindChange((v as FinanceDocKind) ?? kinds[0])}
                items={kinds.map((k) => ({ value: k, label: FINANCE_KINDS[k].label }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {FINANCE_KINDS[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {meta.fromSalesOrder && !preset ? (
            <div className="grid gap-2">
              <Label>Sales order</Label>
              <Combobox
                value={salesOrderId || NONE}
                onChange={(v) => {
                  setSalesOrderId(!v || v === NONE ? "" : v)
                  // Milestones belong to the SO's project — never carry one over.
                  setMilestoneId("")
                }}
                options={[{ value: NONE, label: "—" }, ...soOptions]}
                placeholder="Pick the approved sales order…"
                searchPlaceholder="Search sales orders…"
                emptyMessage="No approved sales orders."
              />
            </div>
          ) : null}

          {meta.parents.length > 0 && !preset ? (
            <div className="grid gap-2">
              <Label>
                From {meta.parents.map((p) => FINANCE_KINDS[p].label.toLowerCase()).join(" / ")}
                {meta.fromSalesOrder ? " (optional)" : ""}
              </Label>
              <Combobox
                value={parentId || NONE}
                onChange={(v) => setParentId(!v || v === NONE ? "" : v)}
                options={[{ value: NONE, label: "—" }, ...parentOptions]}
                placeholder="Pick the source document…"
                searchPlaceholder="Search documents…"
                emptyMessage="No source documents yet."
              />
            </div>
          ) : null}

          {milestoneOptions.length > 0 ? (
            <div className="grid gap-2">
              <Label>Payment milestone (optional)</Label>
              <Combobox
                value={milestoneId || NONE}
                onChange={(v) => {
                  const next = !v || v === NONE ? "" : v
                  setMilestoneId(next)
                  const m = sources.milestones.find((x) => x.id === next)
                  if (m) setAmount(m.amount)
                }}
                options={[{ value: NONE, label: "—" }, ...milestoneOptions]}
                placeholder="Bill a milestone…"
                searchPlaceholder="Search milestones…"
                emptyMessage="No pending milestones."
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="fd-amount">Amount</Label>
              <Input
                id="fd-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fd-party">
                {meta.direction === "sale" ? "Customer" : "Supplier"}
              </Label>
              <Input
                id="fd-party"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder={meta.direction === "sale" ? "Prefilled from the project" : "Supplier name"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fd-date">Date</Label>
              <Input
                id="fd-date"
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fd-due">Due date</Label>
              <Input
                id="fd-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fd-notes">Notes</Label>
            <Textarea
              id="fd-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FinanceDocsTable({
  direction,
  data,
  sources,
  reminderSchedule = [],
}: {
  direction: "sale" | "purchase"
  data: FinanceDocRow[]
  sources: FinanceSources
  /** Tenant reminder schedule (days after due) for the overdue chips. */
  reminderSchedule?: number[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canManage = perms.has(PERMISSIONS.FINANCE_MANAGE)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [childPreset, setChildPreset] = React.useState<{
    kind: FinanceDocKind
    parent: FinanceDocRow
  } | null>(null)

  async function move(doc: FinanceDocRow, next: "issued" | "settled" | "cancelled") {
    const res = await setFinanceDocStatus(doc.id, next)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(`${doc.number} ${next}`)
    router.refresh()
  }

  const columns = React.useMemo<ColumnDef<FinanceDocRow>[]>(
    () => [
      {
        accessorKey: "number",
        header: ({ column }) => <SortableHeader column={column} title="Number" />,
        cell: ({ row }) => (
          <Link
            href={`/billing/${row.original.id}`}
            className="font-mono text-sm font-medium link"
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        id: "kind",
        accessorFn: (r) => FINANCE_KINDS[r.kind].label,
        header: "Type",
        cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge>,
      },
      {
        id: "from",
        header: "From",
        cell: ({ row }) => {
          const r = row.original
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {r.parentNumber ?? r.soNumber ?? "—"}
            </span>
          )
        },
      },
      {
        id: "project",
        accessorFn: (r) => r.projectCode ?? "",
        header: "Project",
        cell: ({ row }) =>
          row.original.projectId ? (
            <Link href={`/projects/${row.original.projectId}`} className="font-mono text-xs link">
              {row.original.projectCode}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "partyName",
        accessorFn: (r) => r.partyName ?? "",
        header: direction === "sale" ? "Customer" : "Supplier",
        cell: ({ getValue }) =>
          getValue<string>() || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "amount",
        accessorFn: (r) => Number(r.amount),
        header: ({ column }) => <SortableHeader column={column} title="Amount" />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.amount, row.original.currency)}
          </span>
        ),
      },
      {
        id: "docDate",
        accessorFn: (r) => r.docDate ?? "",
        header: ({ column }) => <SortableHeader column={column} title="Date" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.docDate ? formatDate(row.original.docDate) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const r = row.original
          const over = r.status === "issued" ? daysOverdue(r.dueDate, new Date()) : 0
          const stageDue = reminderStageDue(r.dueDate, reminderSchedule, new Date())
          const reminderPending = r.status === "issued" && stageDue > r.reminderStage
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={r.status} />
              {over > 0 ? (
                <Badge variant="destructive">{over}d overdue</Badge>
              ) : null}
              {reminderPending ? (
                <Badge variant="secondary">Reminder {r.reminderStage + 1} due</Badge>
              ) : null}
            </div>
          )
        },
      },
      ...(canManage
        ? [
            {
              id: "actions",
              enableHiding: false,
              cell: ({ row }: { row: { original: FinanceDocRow } }) => {
                const r = row.original
                const children = childKinds(r.kind).filter(
                  (k) => FINANCE_KINDS[k].direction === FINANCE_KINDS[r.kind].direction
                )
                return (
                  <div className="flex items-center justify-end gap-2">
                    {r.status === "draft" ? (
                      <>
                        <Button size="sm" onClick={() => move(r, "issued")}>
                          Issue
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => move(r, "cancelled")}>
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    {r.status === "issued"
                      ? children.map((k) => (
                          <Button
                            key={k}
                            size="sm"
                            variant="outline"
                            onClick={() => setChildPreset({ kind: k, parent: r })}
                          >
                            <PlusIcon className="size-4" />
                            {FINANCE_KINDS[k].label}
                          </Button>
                        ))
                      : null}
                  </div>
                )
              },
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, direction]
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        tableId={`finance-${direction}`}
        cap={1000}
        facets={[
          { columnId: "kind", title: "Type" },
          { columnId: "status", title: "Status" },
        ]}
        searchColumn="number"
        searchPlaceholder="Search by number…"
        emptyIcon={FileStackIcon}
        emptyMessage={direction === "sale" ? "No billing documents yet" : "No purchasing documents yet"}
        emptyDescription={
          direction === "sale"
            ? "Create a delivery order or invoice from an approved sales order."
            : "Raise an RFQ or purchase order from an approved sales order."
        }
        emptyAction={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              New document
            </Button>
          ) : undefined
        }
        toolbar={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              New document
            </Button>
          ) : undefined
        }
      />

      {createOpen ? (
        <CreateDocDialog
          direction={direction}
          sources={sources}
          onOpenChange={(o) => !o && setCreateOpen(false)}
        />
      ) : null}
      {childPreset ? (
        <CreateDocDialog
          key={childPreset.parent.id + childPreset.kind}
          direction={direction}
          sources={sources}
          preset={childPreset}
          onOpenChange={(o) => !o && setChildPreset(null)}
        />
      ) : null}
    </>
  )
}
