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
import { Combobox } from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import { SubmitSalesOrderForm } from "./submit-form"
import { type SalesOrderProjectOption } from "./actions"

/**
 * Create entry point for the global Sales Orders list. An SO is always raised
 * against a project, so this dialog asks which project first, then reuses the
 * shared {@link SubmitSalesOrderForm} for the document(s) + notes + atomic
 * submit. Without this the list page would be a read-only dead end.
 */
export function GlobalSubmitSalesOrderDialog({
  projects,
  trigger,
}: {
  projects: SalesOrderProjectOption[]
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  const [projectId, setProjectId] = React.useState("")

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.name} · ${p.projectCode}`,
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setProjectId("")
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
          <SubmitSalesOrderForm
            projectId={projectId}
            submitDisabled={!projectId}
            validate={() => (projectId ? null : "Pick a project")}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          >
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
          </SubmitSalesOrderForm>
        )}
      </DialogContent>
    </Dialog>
  )
}
