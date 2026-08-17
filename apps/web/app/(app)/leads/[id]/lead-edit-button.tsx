"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { LeadForm } from "../lead-form"
import { updateLead, type Lead, type LeadInput } from "../actions"

export function LeadEditButton({
  lead,
}: {
  lead: Lead
}) {
  const router = useRouter()
  const perms = usePermissions()
  const [open, setOpen] = React.useState(false)

  async function handleUpdate(values: LeadInput) {
    const res = await updateLead(lead.id, values)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Lead updated")
    setOpen(false)
    router.refresh()
  }

  if (!perms.has(PERMISSIONS.LEAD_UPDATE)) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Pencil className="size-4" />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
        </DialogHeader>
        <LeadForm
          lead={lead}
          onSubmit={handleUpdate}
          submitLabel="Save changes"
        />
      </DialogContent>
    </Dialog>
  )
}
