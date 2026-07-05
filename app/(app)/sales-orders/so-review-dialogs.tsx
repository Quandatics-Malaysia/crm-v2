"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon, XIcon, ExternalLinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { showActionError } from "@/lib/show-action-error"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { canPreview } from "@/components/document-viewer"
import { formatMoney } from "@/lib/format"
import { approveSalesOrder, rejectSalesOrder, type SalesOrderRow } from "./actions"

/** A labelled key/value line used in the review context block. */
function ContextRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}

/**
 * Inline document preview so an approver can eyeball the proof without leaving
 * the dialog. Previewable types (PDF/image) render in-place; everything else
 * gets a clear "Open" affordance. We avoid nesting the shared DocumentViewer
 * dialog inside this one (nested focus traps) and open in a new tab instead.
 */
function DocumentPreview({
  document,
}: {
  document: NonNullable<SalesOrderRow["document"]>
}) {
  const src = `/api/files/${document.id}`
  const previewable = canPreview(document.contentType)
  const isImage = document.contentType.startsWith("image/")

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={document.fileName}>
          {document.fileName}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.open(previewable ? src : `${src}?dl`)}
        >
          <ExternalLinkIcon className="size-4" />
          Open
        </Button>
      </div>
      {previewable ? (
        <div className="h-64 overflow-hidden rounded-md border bg-muted/40">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={document.fileName}
              className="mx-auto h-full w-full object-contain"
            />
          ) : (
            <iframe
              src={`${src}#view=FitH`}
              title={document.fileName}
              className="h-full w-full border-0"
            />
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Approve dialog with review context — the project value, the source
 * funnel/quotation reference and (if attached) an inline document preview — so
 * issuing the official sales-order number isn't a blind click.
 */
export function ApproveSalesOrderDialog({
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
      showActionError(res)
      setSubmitting(false)
      return
    }
    toast.success(`Sales order approved — ${res.data.soNumber}`)
    onOpenChange(false)
    router.refresh()
    setSubmitting(false)
  }

  const hasContext =
    order.amount != null || order.funnelName || order.quoteNumber

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve sales order</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5 text-sm">
            <ContextRow label="Project">{order.projectName}</ContextRow>
            <ContextRow label="Project code">
              <span className="font-mono">{order.projectCode}</span>
            </ContextRow>
            {hasContext ? (
              <>
                {order.amount != null ? (
                  <ContextRow label="Amount">
                    {formatMoney(order.amount, order.currency)}
                  </ContextRow>
                ) : null}
                {order.funnelName ? (
                  <ContextRow label="Source funnel">{order.funnelName}</ContextRow>
                ) : null}
                {order.quoteNumber ? (
                  <ContextRow label="Quotation">
                    <span className="font-mono">{order.quoteNumber}</span>
                  </ContextRow>
                ) : null}
              </>
            ) : null}
          </div>

          {order.document ? (
            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">
                Supporting document
              </span>
              <DocumentPreview document={order.document} />
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Approving issues an official sales-order number for{" "}
            {order.projectName}.
          </p>
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
          <Button type="button" onClick={onApprove} disabled={submitting}>
            <CheckIcon className="size-4" />
            {submitting ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Decline (reject) dialog — captures a required reason the salesperson sees
 * before resubmitting.
 */
export function DeclineSalesOrderDialog({
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
      showActionError(res)
      setSubmitting(false)
      return
    }
    toast.success("Sales order declined")
    onOpenChange(false)
    router.refresh()
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline sales order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {order.projectName} — the salesperson will see this reason and can
          resubmit.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="decline-reason">Reason</Label>
          <Textarea
            id="decline-reason"
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
            <XIcon className="size-4" />
            {submitting ? "Declining…" : "Decline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
