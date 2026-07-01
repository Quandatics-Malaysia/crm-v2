"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon, XIcon } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DocumentViewerButton } from "@/components/document-viewer"
import { ObjectTile } from "@/components/object-tile"
import { formatDate, formatMoney } from "@/lib/format"
import { SalesOrderStatusBadge } from "../status-badge"
import { ResubmitDialog } from "../resubmit-dialog"
import {
  ApproveSalesOrderDialog,
  DeclineSalesOrderDialog,
} from "../so-review-dialogs"
import type { SalesOrderRow } from "../actions"

export function SalesOrderDetailBody({
  order,
  canApprove,
  canSubmit,
}: {
  order: SalesOrderRow
  canApprove: boolean
  canSubmit: boolean
}) {
  const [approveOpen, setApproveOpen] = React.useState(false)
  const [declineOpen, setDeclineOpen] = React.useState(false)
  const [resubmitOpen, setResubmitOpen] = React.useState(false)

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

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left — sales-order details */}
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
      </div>

      {/* Right — supporting document + review */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Document &amp; review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
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
