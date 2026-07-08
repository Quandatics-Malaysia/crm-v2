"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"

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
import type { Option, CountryOption } from "@/lib/lookups"
import { convertLeadAction } from "./actions"
import type { Lead } from "./actions"

const NEW_ACCOUNT = "__new__"

export function ConvertDialog({
  lead,
  open,
  onOpenChange,
  accountOptions,
  countries = [],
}: {
  lead: Lead
  open: boolean
  onOpenChange: (open: boolean) => void
  accountOptions: Option[]
  countries?: CountryOption[]
}) {
  const router = useRouter()
  // The parent mounts this component fresh per lead, so initialising state from
  // props here is correct — no reset effect required.
  const [createOpportunity, setCreateOpportunity] = React.useState(true)
  const [opportunityName, setOpportunityName] = React.useState(
    `${lead.companyName || lead.name} funnel`
  )
  const [expectedCloseDate, setExpectedCloseDate] = React.useState("")
  // No silent default: the user must deliberately pick an account (existing or
  // "Create new") before converting.
  const [accountId, setAccountId] = React.useState<string>("")
  // Details for the new account (only used on the "Create new account" path).
  const [newType, setNewType] = React.useState<"client" | "reseller">("client")
  const [newCode, setNewCode] = React.useState("")
  const [newPhone, setNewPhone] = React.useState("")
  const [addr, setAddr] = React.useState({
    line1: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
  })
  const [submitting, setSubmitting] = React.useState(false)

  const creatingNew = accountId === NEW_ACCOUNT

  // Cascading address picklists for the new-account path.
  const stateOptions =
    countries.find((c) => c.name === addr.country)?.states ?? []
  const codeValid = /^[A-Za-z0-9]{2,6}$/.test(newCode.trim())

  // A contact needs an email. The server enforces this too, but block early so
  // the user fixes the lead before opening this dialog's flow.
  const missingEmail = !lead.email?.trim()

  async function handleConvert() {
    setSubmitting(true)
    try {
      const res = await convertLeadAction({
        leadId: lead.id,
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName : null,
        expectedCloseDate: createOpportunity ? expectedCloseDate || null : null,
        existingAccountId: creatingNew ? null : accountId,
        newAccount: creatingNew
          ? {
              accountType: newType,
              code: newCode.trim().toUpperCase(),
              phone: newPhone || null,
              address: {
                line1: addr.line1 || null,
                city: addr.city || null,
                state: addr.state || null,
                postcode: addr.postcode || null,
                country: addr.country || null,
              },
            }
          : null,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }

      if (res.data.opportunityId) {
        const oppId = res.data.opportunityId
        toast.success("Lead converted", {
          description: "An Opportunity was created.",
          action: {
            label: "View Opportunity",
            onClick: () => router.push(`/opportunities/${oppId}`),
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
          {missingEmail ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              This lead has no email. A contact must have one — add a valid email
              to the lead before converting.
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="convert-account">
              Account
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </Label>
            <Combobox
              id="convert-account"
              value={accountId}
              onChange={(v) => setAccountId(v || "")}
              options={[
                { value: NEW_ACCOUNT, label: "Create new account" },
                ...accountOptions.map((a) => ({ value: a.id, label: a.name })),
              ]}
              placeholder="Choose an account"
              searchPlaceholder="Search accounts…"
              emptyMessage="No accounts found."
            />
            <p className="text-xs text-muted-foreground">
              {!accountId
                ? "Select an account to attach the contact to, or create a new one."
                : creatingNew
                ? `A new account will be created from “${lead.companyName || lead.name}”.`
                : "The contact will be added to the selected account."}
            </p>
          </div>

          {creatingNew ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                New account details
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-type">Type</Label>
                  <Combobox
                    id="new-acct-type"
                    value={newType}
                    onChange={(v) =>
                      setNewType(v === "reseller" ? "reseller" : "client")
                    }
                    options={[
                      { value: "client", label: "Client (end user)" },
                      { value: "reseller", label: "Reseller (channel)" },
                    ]}
                    placeholder="Client (end user)"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-code">
                    Company code
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Input
                    id="new-acct-code"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="TTDC"
                    maxLength={6}
                    className="uppercase"
                  />
                  {newCode && !codeValid ? (
                    <p className="text-xs text-destructive">
                      2–6 letters/digits.
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-phone">Office phone</Label>
                  <Input
                    id="new-acct-phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="03-2782 2100"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-acct-line1">Address</Label>
                <Input
                  id="new-acct-line1"
                  value={addr.line1}
                  onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))}
                  placeholder="Street address"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  aria-label="City"
                  value={addr.city}
                  onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))}
                  placeholder="City"
                />
                <Input
                  aria-label="Postcode"
                  value={addr.postcode}
                  onChange={(e) =>
                    setAddr((a) => ({ ...a, postcode: e.target.value }))
                  }
                  placeholder="Postcode"
                />
                {countries.length > 0 ? (
                  <Combobox
                    id="new-acct-country"
                    value={addr.country}
                    onChange={(v) =>
                      // Country is country-scoped for states — reset state on change.
                      setAddr((a) => ({ ...a, country: v || "", state: "" }))
                    }
                    options={countries.map((c) => ({
                      value: c.name,
                      label: c.name,
                    }))}
                    placeholder="Country *"
                    searchPlaceholder="Search countries…"
                    emptyMessage="Add countries in Settings."
                  />
                ) : (
                  <Input
                    aria-label="Country"
                    value={addr.country}
                    onChange={(e) =>
                      setAddr((a) => ({ ...a, country: e.target.value }))
                    }
                    placeholder="Country *"
                  />
                )}
                {stateOptions.length > 0 ? (
                  <Combobox
                    id="new-acct-state"
                    value={addr.state}
                    onChange={(v) => setAddr((a) => ({ ...a, state: v || "" }))}
                    options={stateOptions.map((s) => ({ value: s, label: s }))}
                    placeholder="State (optional)"
                    searchPlaceholder="Search states…"
                    emptyMessage="No states."
                  />
                ) : (
                  <Input
                    aria-label="State"
                    value={addr.state}
                    onChange={(e) =>
                      setAddr((a) => ({ ...a, state: e.target.value }))
                    }
                    placeholder="State"
                  />
                )}
              </div>
            </div>
          ) : null}

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
              submitting ||
              missingEmail ||
              !accountId ||
              (creatingNew && (!codeValid || !addr.country.trim())) ||
              (createOpportunity && !opportunityName.trim())
            }
          >
            {submitting ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
