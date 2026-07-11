"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Building2Icon, TargetIcon } from "lucide-react"
import { showActionError } from "@/lib/show-action-error"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import type { Option, CountryOption } from "@/lib/lookups"
import { convertLeadAction, type Lead } from "../../actions"

const NEW_ACCOUNT = "__new__"

/**
 * Full-page lead conversion (replaces the old cramped dialog). Converting is
 * always the full cascade — Account + Contact + Opportunity + Funnel — seeded
 * into the (only) sales pipeline at its first stage, so there is nothing to
 * pick about pipelines here.
 */
export function ConvertForm({
  lead,
  accountOptions,
  countries = [],
}: {
  lead: Lead
  accountOptions: Option[]
  countries?: CountryOption[]
}) {
  const router = useRouter()
  const defaultDealName = `${lead.companyName || lead.name} opportunity`
  const [opportunityName, setOpportunityName] = React.useState(defaultDealName)
  // Mirrors the Opportunity name until the user deliberately diverges it.
  const [funnelName, setFunnelName] = React.useState(defaultDealName)
  const [funnelNameTouched, setFunnelNameTouched] = React.useState(false)
  const [expectedCloseDate, setExpectedCloseDate] = React.useState("")
  const [accountId, setAccountId] = React.useState<string>("")
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
  const stateOptions = countries.find((c) => c.name === addr.country)?.states ?? []
  const codeValid = /^[A-Za-z0-9]{2,6}$/.test(newCode.trim())
  const missingEmail = !lead.email?.trim()

  function onOpportunityNameChange(next: string) {
    setOpportunityName(next)
    if (!funnelNameTouched) setFunnelName(next)
  }

  // Names every unmet requirement so the disabled Convert button is never a
  // silent dead end — the list renders next to it.
  const missing = [
    missingEmail ? "a lead email" : null,
    !accountId ? "Account" : null,
    creatingNew && !codeValid ? "a valid account code (2–6 letters/digits)" : null,
    creatingNew && !addr.country.trim() ? "Country" : null,
    !opportunityName.trim() ? "Opportunity name" : null,
    !funnelName.trim() ? "Funnel name" : null,
  ].filter((m): m is string => m !== null)

  const blocked = submitting || missing.length > 0

  async function handleConvert() {
    setSubmitting(true)
    try {
      const res = await convertLeadAction({
        leadId: lead.id,
        createOpportunity: true,
        opportunityName,
        funnelName,
        expectedCloseDate: expectedCloseDate || null,
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
      toast.success("Lead converted", {
        description: "Account, Contact, Opportunity and Funnel created.",
      })
      if (res.data.opportunityId) {
        router.push(`/opportunities/${res.data.opportunityId}`)
      } else {
        router.push(`/leads/${lead.id}`)
      }
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      {missingEmail ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          This lead has no email. A contact must have one — add a valid email to
          the lead before converting.
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white">
            <Building2Icon className="size-4" />
          </div>
          <div className="grid gap-0.5">
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>
              The company “{lead.name}” becomes a contact of.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="convert-account">
              Account{" "}
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
                ? "Attach the contact to an existing account, or create a new one."
                : creatingNew
                  ? `A new account will be created from “${lead.companyName || lead.name}”.`
                  : "The contact will be added to the selected account."}
            </p>
          </div>

          {creatingNew ? (
            <div className="grid gap-4 rounded-lg border p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                New account details
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-type">Type</Label>
                  <Combobox
                    id="new-acct-type"
                    value={newType}
                    onChange={(v) => setNewType(v === "reseller" ? "reseller" : "client")}
                    options={[
                      { value: "client", label: "Client (end user)" },
                      { value: "reseller", label: "Reseller (channel)" },
                    ]}
                    placeholder="Client (end user)"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-code">
                    Company code{" "}
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
                    <p className="text-xs text-destructive">2–6 letters/digits.</p>
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

              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Address
              </p>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="new-acct-line1">Street address</Label>
                  <Input
                    id="new-acct-line1"
                    value={addr.line1}
                    onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))}
                    placeholder="Level 10, Menara ABC, Jalan Sultan Ismail"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="new-acct-city">City</Label>
                    <Input
                      id="new-acct-city"
                      value={addr.city}
                      onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))}
                      placeholder="Kuala Lumpur"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="new-acct-postcode">Postcode</Label>
                    <Input
                      id="new-acct-postcode"
                      value={addr.postcode}
                      onChange={(e) => setAddr((a) => ({ ...a, postcode: e.target.value }))}
                      placeholder="50250"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="new-acct-country">
                      Country{" "}
                      <span aria-hidden="true" className="text-destructive">
                        *
                      </span>
                    </Label>
                    {countries.length > 0 ? (
                      <Combobox
                        id="new-acct-country"
                        value={addr.country}
                        onChange={(v) =>
                          // States are country-scoped — reset state on change.
                          setAddr((a) => ({ ...a, country: v || "", state: "" }))
                        }
                        options={countries.map((c) => ({ value: c.name, label: c.name }))}
                        placeholder="Choose a country"
                        searchPlaceholder="Search countries…"
                        emptyMessage="Add countries in Settings."
                      />
                    ) : (
                      <Input
                        id="new-acct-country"
                        value={addr.country}
                        onChange={(e) => setAddr((a) => ({ ...a, country: e.target.value }))}
                        placeholder="Malaysia"
                      />
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="new-acct-state">State</Label>
                    {stateOptions.length > 0 ? (
                      <Combobox
                        id="new-acct-state"
                        value={addr.state}
                        onChange={(v) => setAddr((a) => ({ ...a, state: v || "" }))}
                        options={stateOptions.map((s) => ({ value: s, label: s }))}
                        placeholder="Optional"
                        searchPlaceholder="Search states…"
                        emptyMessage="No states."
                      />
                    ) : (
                      <Input
                        id="new-acct-state"
                        value={addr.state}
                        onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value }))}
                        placeholder="Optional"
                        disabled={countries.length > 0 && !addr.country}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white">
            <TargetIcon className="size-4" />
          </div>
          <div className="grid gap-0.5">
            <CardTitle className="text-base">Opportunity &amp; Funnel</CardTitle>
            <CardDescription>
              Created together in the Sales Pipeline at its first stage.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="opp-name">
                Opportunity name{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                id="opp-name"
                value={opportunityName}
                onChange={(e) => onOpportunityNameChange(e.target.value)}
                placeholder={defaultDealName}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="funnel-name">
                Funnel name{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                id="funnel-name"
                value={funnelName}
                onChange={(e) => {
                  setFunnelNameTouched(true)
                  setFunnelName(e.target.value)
                }}
                placeholder={opportunityName || defaultDealName}
              />
              <p className="text-xs text-muted-foreground">
                The first deal under this Opportunity — usually the same name.
              </p>
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
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/leads/${lead.id}`} />}
        >
          Cancel
        </Button>
        <Button type="button" onClick={handleConvert} disabled={blocked}>
          {submitting ? "Converting…" : "Convert lead"}
        </Button>
      </div>
      {missing.length > 0 && !submitting ? (
        <p className="text-right text-xs text-destructive" role="status">
          To convert, fill in: {missing.join(" · ")}
        </p>
      ) : null}
      <p className="text-right text-xs text-muted-foreground">
        Converting creates the Account, Contact, Opportunity and Funnel together.
        This can&apos;t be undone.
      </p>
    </div>
  )
}
