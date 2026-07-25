"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showActionError } from "@/lib/show-action-error"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { disqualifyLead, type Lead } from "../actions"

/**
 * Primary Convert / Disqualify actions for the lead detail header. The decision
 * is usually made on this page, so the affordances live here (not only in the
 * list kebab). Convert navigates to the full-page conversion flow.
 */
export function LeadDetailActions({ lead }: { lead: Lead }) {
  const perms = usePermissions()
  const canConvert = perms.has(PERMISSIONS.LEAD_CONVERT)
  const canUpdate = perms.has(PERMISSIONS.LEAD_UPDATE)
  const [disqualifyOpen, setDisqualifyOpen] = React.useState(false)

  const isConverted = lead.status === "converted"
  const isDisqualified = lead.status === "disqualified"

  return (
    <>
      {canConvert ? (
        <Button
          size="sm"
          disabled={isConverted}
          nativeButton={false}
          render={<Link href={`/leads/${lead.id}/convert`} />}
        >
          Convert
        </Button>
      ) : null}
      {canUpdate ? (
        <Button
          variant="outline"
          size="sm"
          disabled={isConverted || isDisqualified}
          onClick={() => setDisqualifyOpen(true)}
        >
          Disqualify
        </Button>
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
        showActionError(res)
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
