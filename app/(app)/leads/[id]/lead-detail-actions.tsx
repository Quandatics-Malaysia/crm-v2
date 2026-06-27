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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Option } from "@/lib/lookups"
import { ConvertDialog } from "../convert-dialog"
import { disqualifyLead, type Lead } from "../actions"

/**
 * Primary Convert / Disqualify actions for the lead detail header. The decision
 * is usually made on this page, so the affordances live here (not only in the
 * list kebab). Convert reuses the shared ConvertDialog.
 */
export function LeadDetailActions({
  lead,
  accountOptions,
}: {
  lead: Lead
  accountOptions: Option[]
}) {
  const [convertOpen, setConvertOpen] = React.useState(false)
  const [disqualifyOpen, setDisqualifyOpen] = React.useState(false)

  const isConverted = lead.status === "converted"
  const isDisqualified = lead.status === "disqualified"

  return (
    <>
      <Button
        size="sm"
        disabled={isConverted}
        onClick={() => setConvertOpen(true)}
      >
        Convert
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={isConverted || isDisqualified}
        onClick={() => setDisqualifyOpen(true)}
      >
        Disqualify
      </Button>

      {convertOpen ? (
        <ConvertDialog
          lead={lead}
          open={convertOpen}
          onOpenChange={setConvertOpen}
          accountOptions={accountOptions}
        />
      ) : null}

      {disqualifyOpen ? (
        <DisqualifyDialog
          lead={lead}
          onOpenChange={setDisqualifyOpen}
        />
      ) : null}
    </>
  )
}

function DisqualifyDialog({
  lead,
  onOpenChange,
}: {
  lead: Lead
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function handleDisqualify() {
    if (!reason.trim()) {
      toast.error("A reason is required")
      return
    }
    setSubmitting(true)
    try {
      const res = await disqualifyLead(lead.id, reason)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Lead disqualified")
      onOpenChange(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disqualify lead</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="disqualify-reason">Reason</Label>
          <Input
            id="disqualify-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="No budget, wrong fit…"
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
            onClick={handleDisqualify}
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Disqualify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
