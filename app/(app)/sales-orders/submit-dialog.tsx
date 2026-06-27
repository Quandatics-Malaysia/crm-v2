"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { SubmitSalesOrderForm } from "./submit-form"

export function SubmitSalesOrderDialog({
  projectId,
  trigger,
}: {
  projectId: string
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={trigger ?? <Button size="sm">Submit sales order</Button>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit sales order</DialogTitle>
        </DialogHeader>
        <SubmitSalesOrderForm
          projectId={projectId}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
