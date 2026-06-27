"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { DocumentViewerButton } from "@/components/document-viewer"
import { formatDate } from "@/lib/format"
import { SubmitSalesOrderDialog } from "./submit-dialog"
import { ResubmitDialog } from "./resubmit-dialog"
import { SalesOrderStatusBadge } from "./status-badge"
import { type SalesOrderRow } from "./actions"

export function ProjectSalesOrders({
  projectId,
  orders,
  canSubmit = true,
}: {
  projectId: string
  orders: SalesOrderRow[]
  /** Gated on sales_order.submit — hides submit/resubmit for read-only roles. */
  canSubmit?: boolean
}) {
  const [resubmitTarget, setResubmitTarget] = React.useState<SalesOrderRow | null>(
    null
  )

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sales orders</h3>
        {canSubmit ? <SubmitSalesOrderDialog projectId={projectId} /> : null}
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales orders yet.</p>
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <li
              key={o.id}
              className="rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SalesOrderStatusBadge status={o.status} />
                  {o.status === "approved" && o.soNumber ? (
                    <span className="font-mono font-medium">{o.soNumber}</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground">
                  {formatDate(o.submittedAt)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                {o.document ? (
                  <span className="flex items-center gap-1">
                    File:
                    <DocumentViewerButton
                      file={{
                        id: o.document.id,
                        fileName: o.document.fileName,
                        contentType: o.document.contentType,
                      }}
                    />
                  </span>
                ) : null}
              </div>

              {o.status === "rejected" ? (
                <div className="mt-2 grid gap-2">
                  {o.rejectReason ? (
                    <p className="text-destructive">
                      Rejected: {o.rejectReason}
                    </p>
                  ) : null}
                  {canSubmit ? (
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setResubmitTarget(o)}
                      >
                        Resubmit
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {resubmitTarget ? (
        <ResubmitDialog
          key={resubmitTarget.id}
          projectId={projectId}
          order={resubmitTarget}
          open={!!resubmitTarget}
          onOpenChange={(o) => !o && setResubmitTarget(null)}
        />
      ) : null}
    </div>
  )
}
