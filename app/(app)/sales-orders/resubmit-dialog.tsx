"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileDropzone } from "@/components/file-dropzone"
import { uploadEntityAttachment } from "@/app/(app)/_shared/attachment-actions"
import { resubmitSalesOrder, type SalesOrderRow } from "./actions"

/**
 * Resubmit a rejected sales order with an optional replacement document. The SO
 * row already exists, so this stays a two-step flow (status flip, then optional
 * upload) — no orphan-row risk. Shared by the project view and the global table.
 */
export function ResubmitDialog({
  projectId,
  order,
  open,
  onOpenChange,
}: {
  projectId: string
  order: SalesOrderRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [notes, setNotes] = React.useState(order.notes ?? "")
  const [files, setFiles] = React.useState<File[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit() {
    setSubmitting(true)
    const res = await resubmitSalesOrder(order.id, {
      notes: notes.trim() || undefined,
    })
    if (!res.ok) {
      toast.error(res.error)
      setSubmitting(false)
      return
    }
    // A replacement document is optional on resubmit; upload if provided.
    const file = files[0]
    if (file) {
      const fd = new FormData()
      fd.set("file", file)
      fd.set("attachableType", "sales_order")
      fd.set("attachableId", order.id)
      fd.set("revalidate", `/projects/${projectId}`)
      const up = await uploadEntityAttachment(fd)
      if (!up.ok) {
        toast.error(up.error)
        setSubmitting(false)
        return
      }
    }
    toast.success("Sales order resubmitted")
    onOpenChange(false)
    router.refresh()
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resubmit sales order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Replace supporting document (optional)</Label>
            <FileDropzone files={files} onFiles={setFiles} multiple={false} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="resubmit-notes">Notes</Label>
            <Textarea
              id="resubmit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for the reviewer…"
            />
          </div>
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
          <Button type="button" onClick={onSubmit} disabled={submitting}>
            {submitting ? "Resubmitting…" : "Resubmit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
