"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import { CheckIcon, XIcon } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { DocumentViewerButton } from "@/components/document-viewer"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { StatusBadge } from "@/components/status-badge"
import { formatDate, formatMoney } from "@/lib/format"
import { FINANCE_KINDS, type FinanceDocKind } from "@/lib/finance-kinds"
import type { MilestoneItem } from "@/app/(app)/projects/actions"
import type {
  FinanceDocRow,
  ProjectBillingSummary,
} from "@/app/(app)/billing/actions"
import { SalesOrderStatusBadge } from "../status-badge"
import { ResubmitDialog } from "../resubmit-dialog"
import {
  ApproveSalesOrderDialog,
  DeclineSalesOrderDialog,
} from "../so-review-dialogs"
import type { SalesOrderRow } from "../actions"

export function SalesOrderDetailBody({
  order,
  milestones,
  billing,
  canApprove,
  canSubmit,
}: {
  order: SalesOrderRow
  /** Payment milestones on the parent project (empty when projects is off). */
  milestones: MilestoneItem[]
  /** Finance-module billing rollup for the parent project; null when off. */
  billing: ProjectBillingSummary | null
  canApprove: boolean
  canSubmit: boolean
}) {
  const [approveOpen, setApproveOpen] = React.useState(false)
  const [declineOpen, setDeclineOpen] = React.useState(false)
  const [resubmitOpen, setResubmitOpen] = React.useState(false)
  const [tab, setTab] = React.useState("review")

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: <SalesOrderStatusBadge status={order.status} /> },
    {
      label: "SO number",
      value:
        order.status === "approved" && order.soNumber ? (
          <span className="font-mono font-medium">{order.soNumber}</span>
        ) : (
          <span className="text-muted-foreground">Not issued yet</span>
        ),
    },
    {
      label: "Project",
      value: (
        <Link
          href={`/projects/${order.projectId}`}
          className="font-medium link"
        >
          {order.projectName}{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {order.projectCode}
          </span>
        </Link>
      ),
    },
    {
      label: "Value",
      value:
        order.amount != null
          ? formatMoney(order.amount, order.currency)
          : "—",
    },
    { label: "Source funnel", value: order.funnelName ?? "—" },
    {
      label: "Quotation",
      value: order.quoteNumber ? (
        <span className="font-mono">{order.quoteNumber}</span>
      ) : (
        "—"
      ),
    },
    {
      label: "Submitted",
      value: `${order.submittedByName ?? "—"} · ${formatDate(order.submittedAt)}`,
    },
    {
      label: "Reviewed",
      value: order.reviewedAt
        ? `${order.reviewedByName ?? "—"} · ${formatDate(order.reviewedAt)}`
        : "—",
    },
  ]

  const showApprove = canApprove && order.status === "submitted"
  const showResubmit = canSubmit && order.status === "rejected"

  const milestoneColumns = React.useMemo<ColumnDef<MilestoneItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortableHeader column={column} title="Milestone" />,
        cell: ({ row }) => (
          <Link
            href={`/payment-milestones/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "dueDate",
        header: "Due",
        cell: ({ row }) => formatDate(row.original.dueDate),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "amount",
        header: () => <div className="text-right">Amount</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatMoney(row.original.amount, order.currency)}
          </div>
        ),
      },
    ],
    [order.currency]
  )

  const docColumns = React.useMemo<ColumnDef<FinanceDocRow>[]>(
    () => [
      {
        accessorKey: "number",
        header: ({ column }) => <SortableHeader column={column} title="Document" />,
        cell: ({ row }) => (
          <Link href={`/billing/${row.original.id}`} className="font-mono link">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">
            {FINANCE_KINDS[row.original.kind as FinanceDocKind].label}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "dueDate",
        header: "Due",
        cell: ({ row }) => formatDate(row.original.dueDate),
      },
      {
        accessorKey: "amount",
        header: () => <div className="text-right">Amount</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatMoney(row.original.amount, row.original.currency)}
          </div>
        ),
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left — sales-order details + related quick links */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="salesOrder" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Sales order</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {fields.map((d) => (
              <div key={d.label} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{d.label}</span>
                <span className="text-sm">{d.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                { kind: "project", label: "Project", href: `/projects/${order.projectId}` },
                { kind: "milestone", label: "Payment milestones", count: milestones.length, onSelect: () => setTab("milestones") },
                ...(billing
                  ? [{ kind: "document" as const, label: "Finance docs", count: billing.docs.length, onSelect: () => setTab("billing") }]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right — tabbed review + related lists */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="review">Document &amp; review</TabsTrigger>
                <TabsTrigger value="milestones">
                  Payment milestones
                  <Badge variant="secondary" className="ml-1.5">
                    {milestones.length}
                  </Badge>
                </TabsTrigger>
                {billing ? (
                  <TabsTrigger value="billing">
                    Finance docs
                    <Badge variant="secondary" className="ml-1.5">
                      {billing.docs.length}
                    </Badge>
                  </TabsTrigger>
                ) : null}
              </TabsList>

              <TabsContent value="review" className="mt-4">
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      Supporting document
                    </span>
                    {order.document ? (
                      <DocumentViewerButton
                        file={{
                          id: order.document.id,
                          fileName: order.document.fileName,
                          contentType: order.document.contentType,
                        }}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No document attached.
                      </span>
                    )}
                  </div>

                  {order.notes ? (
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">Notes</span>
                      <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
                    </div>
                  ) : null}

                  {order.status === "rejected" && order.rejectReason ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      Rejected: {order.rejectReason}
                    </div>
                  ) : null}

                  {showApprove || showResubmit ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                      {showApprove ? (
                        <>
                          <Button type="button" size="sm" onClick={() => setApproveOpen(true)}>
                            <CheckIcon className="size-4" />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeclineOpen(true)}
                          >
                            <XIcon className="size-4" />
                            Decline
                          </Button>
                        </>
                      ) : null}
                      {showResubmit ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setResubmitOpen(true)}
                        >
                          Resubmit
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="milestones" className="mt-4">
                <DataTable
                  columns={milestoneColumns}
                  data={milestones}
                  tableId="so-milestones"
                  searchColumn="title"
                  searchPlaceholder="Search milestones…"
                  emptyMessage="No payment milestones on this project yet."
                  pageSize={5}
                />
              </TabsContent>

              {billing ? (
                <TabsContent value="billing" className="mt-4">
                  <DataTable
                    columns={docColumns}
                    data={billing.docs}
                    tableId="so-finance-docs"
                    searchColumn="number"
                    searchPlaceholder="Search finance docs…"
                    emptyMessage="No finance documents on this project yet."
                    pageSize={5}
                  />
                </TabsContent>
              ) : null}
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {approveOpen ? (
        <ApproveSalesOrderDialog
          order={order}
          open={approveOpen}
          onOpenChange={setApproveOpen}
        />
      ) : null}
      {declineOpen ? (
        <DeclineSalesOrderDialog
          order={order}
          open={declineOpen}
          onOpenChange={setDeclineOpen}
        />
      ) : null}
      {resubmitOpen ? (
        <ResubmitDialog
          projectId={order.projectId}
          order={order}
          open={resubmitOpen}
          onOpenChange={setResubmitOpen}
        />
      ) : null}
    </div>
  )
}
