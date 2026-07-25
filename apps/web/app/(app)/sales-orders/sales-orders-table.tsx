"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, MoreHorizontal, XIcon } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader, linkCell } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DocumentViewerButton } from "@/components/document-viewer"
import { SalesOrderStatusBadge } from "./status-badge"
import { GlobalSubmitSalesOrderDialog } from "./global-submit-dialog"
import { formatDate } from "@/lib/format"
import { ResubmitDialog } from "./resubmit-dialog"
import {
  ApproveSalesOrderDialog,
  DeclineSalesOrderDialog,
} from "./so-review-dialogs"
import {
  type SalesOrderRow,
  type SalesOrderProjectOption,
} from "./actions"

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
        cell: linkCell(
          (r) => `/projects/${r.projectId}`,
          (r) => r.projectName
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
            <Link
              href={`/sales-orders/${row.original.id}`}
              className="font-mono link"
            >
              {row.original.soNumber}
            </Link>
          ) : (
            <Link
              href={`/sales-orders/${row.original.id}`}
              className="link"
            >
              View
            </Link>
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
          // Reviewers awaiting a decision get clearly-labelled primary Approve /
          // destructive Decline buttons right on the row — never buried in a
          // kebab — so the next action is unmistakable. The kebab keeps the
          // secondary actions (open / resubmit).
          return (
            <div className="flex items-center justify-end gap-2">
              {canApprove && pending ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => setApproveTarget(order)}
                  >
                    <CheckIcon className="size-4" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setRejectTarget(order)}
                  >
                    <XIcon className="size-4" />
                    Decline
                  </Button>
                </>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More actions</span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => router.push(`/projects/${order.projectId}`)}
                  >
                    Open in project
                  </DropdownMenuItem>
                  {canApprove ? (
                    <>
                      <DropdownMenuSeparator />
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
                        Decline
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canSubmit ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!rejected}
                        onClick={() => setResubmitTarget(order)}
                      >
                        Resubmit
                      </DropdownMenuItem>
                    </>
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
        cap={1000}
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
        <ApproveSalesOrderDialog
          key={approveTarget.id}
          order={approveTarget}
          open={!!approveTarget}
          onOpenChange={(o) => !o && setApproveTarget(null)}
        />
      ) : null}

      {rejectTarget ? (
        <DeclineSalesOrderDialog
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
