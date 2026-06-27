"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
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
import { SalesOrderStatusBadge } from "./status-badge"
import { GlobalSubmitSalesOrderDialog } from "./global-submit-dialog"
import { formatDate } from "@/lib/format"
import { ResubmitDialog } from "./resubmit-dialog"
import {
  approveSalesOrder,
  rejectSalesOrder,
  type SalesOrderRow,
  type SalesOrderProjectOption,
} from "./actions"

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
    const res = await approveSalesOrder(order.id)
    if (!res.ok) {
      toast.error(res.error)
      setSubmitting(false)
      return
    }
    toast.success(`Sales order approved — ${res.data.soNumber}`)
    onOpenChange(false)
    router.refresh()
    setSubmitting(false)
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
    const res = await rejectSalesOrder(order.id, reason)
    if (!res.ok) {
      toast.error(res.error)
      setSubmitting(false)
      return
    }
    toast.success("Sales order rejected")
    onOpenChange(false)
    router.refresh()
    setSubmitting(false)
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
  projects,
}: {
  data: SalesOrderRow[]
  canApprove: boolean
  canSubmit: boolean
  projects: SalesOrderProjectOption[]
}) {
  const router = useRouter()
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
              <SalesOrderStatusBadge status={o.status} />
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
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => router.push(`/projects/${order.projectId}`)}
                  >
                    Open in project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
  }, [canApprove, canSubmit, router])

  const submitAction = canSubmit ? (
    <GlobalSubmitSalesOrderDialog projects={projects} />
  ) : null

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
        emptyDescription={
          canSubmit
            ? "Submit a sales order against one of your projects to get started."
            : "Sales orders are created from inside a project."
        }
        emptyAction={submitAction}
        toolbar={submitAction}
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
