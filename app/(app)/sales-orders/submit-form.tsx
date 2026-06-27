"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/file-dropzone"
import { submitSalesOrderWithDocument } from "./actions"

/**
 * Shared body for the "Submit sales order" dialogs: the file dropzone, the notes
 * field, and the atomic submit loop (one SO per dropped document, each created
 * together with its file so a row never exists without its document).
 *
 * The project-scoped dialog passes a fixed `projectId`; the global dialog renders
 * its project picker via `children` and supplies `projectId` from its own state
 * plus a `validate` guard. Centralizing this removes the previously duplicated
 * file / notes state, validation, toast, and submit logic across both dialogs.
 */
export function SubmitSalesOrderForm({
  projectId,
  children,
  validate,
  submitDisabled,
  onDone,
  onCancel,
}: {
  projectId: string
  /** Extra fields rendered above the dropzone (e.g. the global project picker). */
  children?: React.ReactNode
  /** Returns an error message to block submit, or null when valid. */
  validate?: () => string | null
  /** Disables the Submit button regardless of file state (e.g. no project yet). */
  submitDisabled?: boolean
  /** Called after a successful submit so the wrapper can close (and reset). */
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [files, setFiles] = React.useState<File[]>([])
  const [notes, setNotes] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit() {
    const err = validate?.()
    if (err) {
      toast.error(err)
      return
    }
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
    setFiles([])
    setNotes("")
    router.refresh()
    setSubmitting(false)
    onDone()
  }

  return (
    <>
      <div className="grid gap-4">
        {children}
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
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={submitting || files.length < 1 || submitDisabled}
        >
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </DialogFooter>
    </>
  )
}
