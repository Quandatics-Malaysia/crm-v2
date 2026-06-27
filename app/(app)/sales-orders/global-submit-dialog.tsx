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
import { Combobox } from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/file-dropzone"
import {
  submitSalesOrderWithDocument,
  type SalesOrderProjectOption,
} from "./actions"

/**
 * Create entry point for the global Sales Orders list. An SO is always raised
 * against a project, so this dialog asks which project first, then takes the
 * supporting document(s) and submits — the same atomic action the project panel
 * uses. Without this the list page would be a read-only dead end.
 */
export function GlobalSubmitSalesOrderDialog({
  projects,
  trigger,
}: {
  projects: SalesOrderProjectOption[]
  trigger?: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [projectId, setProjectId] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [notes, setNotes] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  function reset() {
    setProjectId("")
    setFiles([])
    setNotes("")
  }

  async function onSubmit() {
    if (!projectId) {
      toast.error("Pick a project")
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
    setOpen(false)
    reset()
    router.refresh()
    setSubmitting(false)
  }

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.name} · ${p.projectCode}`,
  }))

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
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no projects to submit against yet. Create a project first,
            then submit its sales order from the project page.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="so-project">
                Project
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Combobox
                id="so-project"
                value={projectId}
                onChange={setProjectId}
                options={projectOptions}
                placeholder="Select a project…"
                searchPlaceholder="Search projects…"
                emptyMessage="No projects found."
              />
            </div>
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
        )}
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
            disabled={submitting || !projectId || files.length < 1}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
