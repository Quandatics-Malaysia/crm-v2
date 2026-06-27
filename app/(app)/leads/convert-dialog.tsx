"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Combobox } from "@/components/ui/combobox"
import type { Option } from "@/lib/lookups"
import { convertLeadAction } from "./actions"
import type { Lead } from "./actions"

const NEW_ACCOUNT = "__new__"

export function ConvertDialog({
  lead,
  open,
  onOpenChange,
  accountOptions,
}: {
  lead: Lead
  open: boolean
  onOpenChange: (open: boolean) => void
  accountOptions: Option[]
}) {
  const router = useRouter()
  // The parent mounts this component fresh per lead, so initialising state from
  // props here is correct — no reset effect required.
  const [createOpportunity, setCreateOpportunity] = React.useState(true)
  const [opportunityName, setOpportunityName] = React.useState(
    `${lead.companyName || lead.name} funnel`
  )
  const [expectedCloseDate, setExpectedCloseDate] = React.useState("")
  const [accountId, setAccountId] = React.useState<string>(NEW_ACCOUNT)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleConvert() {
    setSubmitting(true)
    try {
      const res = await convertLeadAction({
        leadId: lead.id,
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName : null,
        expectedCloseDate: createOpportunity ? expectedCloseDate || null : null,
        existingAccountId: accountId === NEW_ACCOUNT ? null : accountId,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }

      if (res.data.opportunityId) {
        const oppId = res.data.opportunityId
        toast.success("Lead converted", {
          description: "A Funnel was created.",
          action: {
            label: "View Funnel",
            onClick: () => router.push(`/funnel/${oppId}`),
          },
        })
      } else {
        toast.success("Lead converted")
      }

      onOpenChange(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert lead</DialogTitle>
          <DialogDescription>
            Turn “{lead.name}” into an account and contact, and optionally seed a
            Funnel. This can’t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="convert-account">Account</Label>
            <Combobox
              id="convert-account"
              value={accountId}
              onChange={(v) => setAccountId(v || NEW_ACCOUNT)}
              options={[
                { value: NEW_ACCOUNT, label: "Create new account" },
                ...accountOptions.map((a) => ({ value: a.id, label: a.name })),
              ]}
              placeholder="Choose an account"
              searchPlaceholder="Search accounts…"
              emptyMessage="No accounts found."
            />
            <p className="text-xs text-muted-foreground">
              {accountId === NEW_ACCOUNT
                ? `A new account will be created from “${lead.companyName || lead.name}”.`
                : "The contact will be added to the selected account."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="create-opp">Create Funnel</Label>
              <p className="text-xs text-muted-foreground">
                Seed a Funnel at the first stage.
              </p>
            </div>
            <Switch
              id="create-opp"
              checked={createOpportunity}
              onCheckedChange={(v) => setCreateOpportunity(v)}
            />
          </div>

          {createOpportunity ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="opp-name">Funnel name</Label>
                <Input
                  id="opp-name"
                  value={opportunityName}
                  onChange={(e) => setOpportunityName(e.target.value)}
                  placeholder="New funnel"
                />
                {!opportunityName.trim() ? (
                  <p className="text-xs text-destructive">
                    A Funnel name is required.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="opp-close">Expected close date</Label>
                <Input
                  id="opp-close"
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                />
              </div>
            </div>
          ) : null}
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
            onClick={handleConvert}
            disabled={
              submitting || (createOpportunity && !opportunityName.trim())
            }
          >
            {submitting ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
