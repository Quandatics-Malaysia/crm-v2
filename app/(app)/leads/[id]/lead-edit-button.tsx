"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { FunnelWithStages } from "@/lib/lookups"
import { LeadForm } from "../lead-form"
import { updateLead, type Lead, type LeadInput } from "../actions"

export function LeadEditButton({
  lead,
  funnels,
}: {
  lead: Lead
  funnels: FunnelWithStages[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  async function handleUpdate(values: LeadInput) {
    const res = await updateLead(lead.id, values)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Lead updated")
    setOpen(false)
    router.refresh()
  }

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
          funnels={funnels}
          onSubmit={handleUpdate}
          submitLabel="Save changes"
        />
      </DialogContent>
    </Dialog>
  )
}
