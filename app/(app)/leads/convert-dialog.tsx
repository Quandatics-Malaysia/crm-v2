"use client"

import * as React from "react"
import Link from "next/link"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
      const result = await convertLeadAction({
        leadId: lead.id,
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName : null,
        expectedCloseDate: createOpportunity ? expectedCloseDate || null : null,
        existingAccountId: accountId === NEW_ACCOUNT ? null : accountId,
      })

      if (result.opportunityId) {
        const oppId = result.opportunityId
        toast.success("Lead converted", {
          description: "A funnel was created.",
          action: {
            label: "View funnel",
            onClick: () => router.push(`/funnel/${oppId}`),
          },
        })
      } else {
        toast.success("Lead converted")
      }

      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to convert lead")
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
            funnel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="convert-account">Account</Label>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(v ?? NEW_ACCOUNT)}
            >
              <SelectTrigger id="convert-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_ACCOUNT}>
                  Create new account
                </SelectItem>
                {accountOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {accountId === NEW_ACCOUNT
                ? `A new account will be created from “${lead.companyName || lead.name}”.`
                : "The contact will be added to the selected account."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="create-opp">Create funnel</Label>
              <p className="text-xs text-muted-foreground">
                Seed a deal at the first pipeline stage.
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
                  placeholder="New deal"
                />
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
          <Button type="button" onClick={handleConvert} disabled={submitting}>
            {submitting ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Tiny helper kept for callers that need to render a deep link inline. */
export function OpportunityLink({ id }: { id: string }) {
  return (
    <Link className="underline underline-offset-4" href={`/funnel/${id}`}>
      View funnel
    </Link>
  )
}
