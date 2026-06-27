"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/file-dropzone"
import { submitSalesOrderWithDocument } from "./actions"

export function SubmitSalesOrderDialog({
  projectId,
  trigger,
}: {
  projectId: string
  trigger?: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [files, setFiles] = React.useState<File[]>([])
  const [notes, setNotes] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  function reset() {
    setFiles([])
    setNotes("")
  }

  async function onSubmit() {
    if (files.length === 0) {
      toast.error("Add at least one document")
      return
    }
    setSubmitting(true)
    // Each dropped document becomes its own sales-order submission, created
    // atomically with its file so a row never exists without its document.
    for (const file of files) {
      const fd = new FormData()
      fd.set("file", file)
      fd.set("projectId", projectId)
      if (notes.trim()) fd.set("notes", notes.trim())
      const res = await submitSalesOrderWithDocument(fd)
      if (!res.ok) {
        toast.error(res.error)
        setSubmitting(false)
        return
      }
    }
    toast.success(
      files.length > 1
        ? `${files.length} sales orders submitted`
        : "Sales order submitted"
    )
    setOpen(false)
    reset()
    router.refresh()
    setSubmitting(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger
        render={trigger ?? <Button size="sm">Submit sales order</Button>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit sales order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <FileDropzone files={files} onFiles={setFiles} multiple />
          <div className="grid gap-2">
            <Label htmlFor="so-notes">Notes</Label>
            <Textarea
              id="so-notes"
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
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || files.length < 1}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
