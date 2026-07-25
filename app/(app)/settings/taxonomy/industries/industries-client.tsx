"use client"

import * as React from "react"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { Plus, X } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { PicklistCard } from "@/components/picklist-card"
import {
  updateIndustries,
  updateCountries,
  updateLeadSources,
  updateLossReasons,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import { DEFAULT_LEAD_SOURCES, DEFAULT_LOSS_REASONS } from "@/lib/tenant-defaults"

// ─── Industries — a plain PicklistCard instance (standard chip-list CRUD) ────

function IndustriesCard({ industries }: { industries: string[] }) {
  return (
    <PicklistCard
      title="Industries"
      description="Industry picklist offered on accounts."
      items={industries}
      defaults={[]}
      placeholder="e.g. Banking"
      save={updateIndustries}
    />
  )
}

// ─── Countries & states ────────────────────────────────────────────────────────

function CountriesCard({
  countries,
}: {
  countries: { name: string; states: string[] }[]
}) {
  const [items, setItems] = React.useState(countries)
  const [countryDraft, setCountryDraft] = React.useState("")
  const [stateDrafts, setStateDrafts] = React.useState<Record<string, string>>(
    {}
  )
  const [isPending, startTransition] = React.useTransition()

  const dirty = React.useMemo(
    () => JSON.stringify(items) !== JSON.stringify(countries),
    [items, countries]
  )

  function addCountry() {
    const name = countryDraft.trim()
    if (!name) return
    if (items.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("That country is already in the list.")
      return
    }
    setItems((prev) => [...prev, { name, states: [] }])
    setCountryDraft("")
  }

  function removeCountry(name: string) {
    setItems((prev) => prev.filter((c) => c.name !== name))
  }

  function addState(country: string) {
    const st = (stateDrafts[country] ?? "").trim()
    if (!st) return
    setItems((prev) =>
      prev.map((c) => {
        if (c.name !== country) return c
        if (c.states.some((s) => s.toLowerCase() === st.toLowerCase())) return c
        return { ...c, states: [...c.states, st] }
      })
    )
    setStateDrafts((d) => ({ ...d, [country]: "" }))
  }

  function removeState(country: string, st: string) {
    setItems((prev) =>
      prev.map((c) =>
        c.name === country
          ? { ...c, states: c.states.filter((s) => s !== st) }
          : c
      )
    )
  }

  function save() {
    startTransition(async () => {
      const res = await updateCountries(items)
      if (!res.ok) {
        showActionError(res)
        return
      }
      setItems(res.data)
      toast.success("Countries saved")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Countries & states</CardTitle>
        <CardDescription>
          The country picklist for account addresses. Each country carries its
          own states/provinces, offered once that country is selected on an
          account.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex gap-2">
          <Input
            value={countryDraft}
            onChange={(e) => setCountryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCountry()
              }
            }}
            placeholder="e.g. Malaysia"
          />
          <Button type="button" variant="outline" onClick={addCountry}>
            <Plus className="size-4" />
            Add country
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3">
            {items.map((c) => (
              <div key={c.name} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => removeCountry(c.name)}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
                    aria-label={`Remove ${c.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {c.states.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {c.states.map((s) => (
                      <Badge key={s} variant="secondary" className="gap-1 pr-1">
                        {s}
                        <button
                          type="button"
                          onClick={() => removeState(c.name, s)}
                          className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                          aria-label={`Remove ${s}`}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No states yet (optional)." className="py-4" />
                )}
                <div className="flex gap-2">
                  <Input
                    value={stateDrafts[c.name] ?? ""}
                    onChange={(e) =>
                      setStateDrafts((d) => ({
                        ...d,
                        [c.name]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addState(c.name)
                      }
                    }}
                    placeholder="Add a state / province"
                    className="h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addState(c.name)}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No countries yet." />
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={isPending || !dirty}>
            {isPending ? "Saving…" : "Save countries"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function IndustriesClient({ settings }: { settings: TenantSettingsView }) {
  return (
    <div className="grid gap-4">
      <IndustriesCard industries={settings.industries} />
      <CountriesCard countries={settings.countries} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PicklistCard
          title="Lead sources"
          description="Where a lead came from — offered in the lead form so sources stay consistent for reporting."
          items={settings.leadSources}
          defaults={DEFAULT_LEAD_SOURCES}
          placeholder="e.g. Webinar"
          save={updateLeadSources}
        />
        <PicklistCard
          title="Loss / disqualify reasons"
          description="Offered when disqualifying a lead (and available for lost-deal analysis)."
          items={settings.lossReasons}
          defaults={DEFAULT_LOSS_REASONS}
          placeholder="e.g. No budget"
          save={updateLossReasons}
        />
      </div>
    </div>
  )
}
