"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DocumentViewerButton } from "@/components/document-viewer"
import { formatDate } from "@/lib/format"
import { ResubmitDialog } from "./resubmit-dialog"
import {
  approveSalesOrder,
  rejectSalesOrder,
  type SalesOrderRow,
} from "./actions"

function StatusBadge({ status }: { status: SalesOrderRow["status"] }) {
  if (status === "approved") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        Approved
      </Badge>
    )
  }
  if (status === "rejected") {
    return <Badge variant="destructive">Rejected</Badge>
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
      Pending review
    </Badge>
  )
}

function ApproveDialog({
  order,
  open,
  onOpenChange,
}: {
  order: SalesOrderRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)

  async function onApprove() {
    setSubmitting(true)
    try {
      const { soNumber } = await approveSalesOrder(order.id)
      toast.success(`Sales order approved — ${soNumber}`)
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve sales order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Approving issues a sales-order number for {order.projectName}.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onApprove} disabled={submitting}>
            {submitting ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({
  order,
  open,
  onOpenChange,
}: {
  order: SalesOrderRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function onReject() {
    if (!reason.trim()) {
      toast.error("A reason is required")
      return
    }
    setSubmitting(true)
    try {
      await rejectSalesOrder(order.id, reason)
      toast.success("Sales order rejected")
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject sales order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Missing signature, wrong amount…"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onReject}
            disabled={submitting}
          >
            {submitting ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SalesOrdersTable({
  data,
  canApprove,
  canSubmit,
}: {
  data: SalesOrderRow[]
  canApprove: boolean
  canSubmit: boolean
}) {
  const [approveTarget, setApproveTarget] = React.useState<SalesOrderRow | null>(
    null
  )
  const [rejectTarget, setRejectTarget] = React.useState<SalesOrderRow | null>(
    null
  )
  const [resubmitTarget, setResubmitTarget] =
    React.useState<SalesOrderRow | null>(null)

  const columns = React.useMemo<ColumnDef<SalesOrderRow>[]>(() => {
    const cols: ColumnDef<SalesOrderRow>[] = [
      {
        accessorKey: "projectName",
        header: ({ column }) => (
          <SortableHeader column={column} title="Project" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/projects/${row.original.projectId}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.projectName}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <SortableHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const o = row.original
          return (
            <div className="grid gap-0.5">
              <StatusBadge status={o.status} />
              {o.status === "rejected" && o.rejectReason ? (
                <span
                  className="max-w-[16rem] truncate text-xs text-destructive"
                  title={o.rejectReason}
                >
                  {o.rejectReason}
                </span>
              ) : null}
            </div>
          )
        },
      },
      {
        accessorKey: "soNumber",
        header: "SO number",
        cell: ({ row }) =>
          row.original.soNumber ? (
            <span className="font-mono">{row.original.soNumber}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "submittedByName",
        accessorFn: (r) => r.submittedByName ?? "",
        header: "Submitted by",
        cell: ({ getValue }) => {
          const v = getValue<string>()
          return v ? (
            v
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        },
      },
      {
        accessorKey: "submittedAt",
        header: ({ column }) => (
          <SortableHeader column={column} title="Submitted" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.submittedAt)}
          </span>
        ),
      },
      {
        id: "document",
        header: "Document",
        cell: ({ row }) =>
          row.original.document ? (
            <DocumentViewerButton
              file={{
                id: row.original.document.id,
                fileName: row.original.document.fileName,
                contentType: row.original.document.contentType,
              }}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ]

    if (canApprove || canSubmit) {
      cols.push({
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const order = row.original
          const pending = order.status === "submitted"
          const rejected = order.status === "rejected"
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">Open menu</span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-40">
                  {canApprove ? (
                    <>
                      <DropdownMenuItem
                        disabled={!pending}
                        onClick={() => setApproveTarget(order)}
                      >
                        Approve
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!pending}
                        onClick={() => setRejectTarget(order)}
                      >
                        Reject
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canApprove && canSubmit ? <DropdownMenuSeparator /> : null}
                  {canSubmit ? (
                    <DropdownMenuItem
                      disabled={!rejected}
                      onClick={() => setResubmitTarget(order)}
                    >
                      Resubmit
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      })
    }

    return cols
  }, [canApprove, canSubmit])

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        tableId="sales-orders"
        facets={[{ columnId: "status", title: "Status" }]}
        searchColumn="projectName"
        searchPlaceholder="Search by project…"
        emptyMessage="No sales orders yet."
      />

      {approveTarget ? (
        <ApproveDialog
          key={approveTarget.id}
          order={approveTarget}
          open={!!approveTarget}
          onOpenChange={(o) => !o && setApproveTarget(null)}
        />
      ) : null}

      {rejectTarget ? (
        <RejectDialog
          key={rejectTarget.id}
          order={rejectTarget}
          open={!!rejectTarget}
          onOpenChange={(o) => !o && setRejectTarget(null)}
        />
      ) : null}

      {resubmitTarget ? (
        <ResubmitDialog
          key={resubmitTarget.id}
          projectId={resubmitTarget.projectId}
          order={resubmitTarget}
          open={!!resubmitTarget}
          onOpenChange={(o) => !o && setResubmitTarget(null)}
        />
      ) : null}
    </>
  )
}
