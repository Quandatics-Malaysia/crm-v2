"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { uploadEntityAttachment } from "@/app/(app)/_shared/attachment-actions"
import { setSoNumber } from "../actions"

export function RecordSoDialog({
  opportunityId,
  currentSoNumber,
  trigger,
}: {
  opportunityId: string
  currentSoNumber?: string | null
  trigger?: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [soNumber, setSoNumberValue] = React.useState(currentSoNumber ?? "")
  const [file, setFile] = React.useState<File | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Business rule: an SO cannot be recorded without BOTH a number AND a
  // supporting document (the PO or signed-back quotation).
  const canSubmit = soNumber.trim().length > 0 && file !== null

  function reset() {
    setSoNumberValue(currentSoNumber ?? "")
    setFile(null)
    setSubmitting(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function onSubmit() {
    if (!canSubmit || !file) {
      toast.error("An SO number and a supporting document are both required")
      return
    }
    setSubmitting(true)
    try {
      // Upload the document FIRST so we never record an SO without its proof.
      const fd = new FormData()
      fd.set("file", file)
      fd.set("attachableType", "opportunity")
      fd.set("attachableId", opportunityId)
      fd.set("revalidate", `/funnel/${opportunityId}`)
      await uploadEntityAttachment(fd)

      await setSoNumber(opportunityId, soNumber)

      toast.success("SO recorded")
      setOpen(false)
      reset()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record SO")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger render={trigger ?? <Button>Record SO</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record SO</DialogTitle>
          <DialogDescription>
            A Sales Order requires both an SO number and a supporting document
            (the PO or signed-back quotation). You cannot record an SO without a
            file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="so-number">
              SO Number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="so-number"
              placeholder="e.g. SO-2026-0142"
              value={soNumber}
              onChange={(e) => setSoNumberValue(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="so-file">
              Attach signed PO / quotation{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              ref={inputRef}
              id="so-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {file
                ? file.name
                : "Required — the PO or signed-back quotation."}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || submitting}
            >
              Record SO
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
