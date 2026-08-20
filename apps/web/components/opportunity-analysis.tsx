"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { InlineCombobox } from "@/components/inline-combobox"
import { InlineValue } from "@/components/inline-value"
import { formatDate, formatMoney } from "@/lib/format"
import type { OpportunityContainerDetail, OpportunityContainerUpdateInput } from "@/app/(app)/opportunities/actions"

type Opportunity = OpportunityContainerDetail["opportunity"]

function AnalysisSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-[3px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-muted px-3 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/80"
      >
        <ChevronDownIcon
          aria-hidden
          className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {title}
      </button>
      {open ? <div className="divide-y divide-border">{children}</div> : null}
    </section>
  )
}

function AnalysisRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-7 grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)] items-center gap-x-5 px-3 py-1 text-sm">
      <span className="text-foreground">{label}</span>
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  )
}

export function OpportunityAnalysis({
  opportunity,
  contact,
  contactOptions,
  canEdit,
  onSave,
}: {
  opportunity: Opportunity
  contact?: OpportunityContainerDetail["powerSponsorContact"]
  contactOptions: { value: string; label: string }[]
  canEdit: boolean
  onSave: (patch: OpportunityContainerUpdateInput) => Promise<void>
}) {
  const o = opportunity
  const contactDisplay = contact ? (
    <span className="text-blue-700 underline underline-offset-2 dark:text-blue-400">
      {contact.name}
    </span>
  ) : (
    "—"
  )

  return (
    <div className="border-t border-border bg-background">
      <div className="grid gap-2 p-3">
        <AnalysisSection title="1-P: Power Sponsor (PS)">
          <AnalysisRow label="Power Sponsor Contact">
            {canEdit ? (
              <InlineCombobox
                value={o.powerSponsorContactId ?? ""}
                display={contactDisplay}
                options={contactOptions}
                onSave={(next) => onSave({ powerSponsorContactId: next || null })}
                placeholder="Optional"
                searchPlaceholder="Search contacts…"
                emptyMessage="No contacts for this account."
                title="Click to change power sponsor contact"
                className="flex w-full items-center justify-between gap-2"
              />
            ) : (
              contactDisplay
            )}
          </AnalysisRow>
          <AnalysisRow label="Power Sponsor Designation">
            {contact?.designation || "—"}
          </AnalysisRow>
          <AnalysisRow label="Power Sponsor Budget Limit">
            {canEdit ? (
              <InlineValue
                value={o.powerSponsorBudgetLimit ?? ""}
                display={formatMoney(o.powerSponsorBudgetLimit, o.currency)}
                formatDraft={(value) => formatMoney(value || "0", o.currency)}
                type="number"
                title="Click to edit power sponsor budget limit"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ powerSponsorBudgetLimit: next || null })}
              />
            ) : (
              formatMoney(o.powerSponsorBudgetLimit, o.currency)
            )}
          </AnalysisRow>
        </AnalysisSection>

        <AnalysisSection title="2-P: Pain (Objective)">
          <AnalysisRow label="Objective">
            {canEdit ? (
              <InlineValue
                value={o.pain ?? ""}
                display={o.pain || "—"}
                title="Click to edit objective"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ pain: next || null })}
              />
            ) : (
              o.pain || "—"
            )}
          </AnalysisRow>
        </AnalysisSection>

        <AnalysisSection title="3-V: Vision">
          <AnalysisRow label="Vision">
            {canEdit ? (
              <InlineValue
                value={o.vision ?? ""}
                display={o.vision || "—"}
                title="Click to edit vision"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ vision: next || null })}
              />
            ) : (
              o.vision || "—"
            )}
          </AnalysisRow>
        </AnalysisSection>

        <AnalysisSection title="4-V: Value">
          <AnalysisRow label="Value">
            {canEdit ? (
              <InlineValue
                value={o.value ?? ""}
                display={o.value || "—"}
                title="Click to edit value"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ value: next || null })}
              />
            ) : (
              o.value || "—"
            )}
          </AnalysisRow>
        </AnalysisSection>

        <AnalysisSection title="5-C: Control">
          <AnalysisRow label="Estimated Budget">
            {canEdit ? (
              <InlineValue
                value={o.estimatedBudget ?? ""}
                display={formatMoney(o.estimatedBudget, o.currency)}
                formatDraft={(value) => formatMoney(value || "0", o.currency)}
                type="number"
                title="Click to edit estimated budget"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ estimatedBudget: next || null })}
              />
            ) : (
              formatMoney(o.estimatedBudget, o.currency)
            )}
          </AnalysisRow>
          <AnalysisRow label="Estimated Close Date">
            {canEdit ? (
              <InlineValue
                value={o.estimatedCloseDate ?? ""}
                display={formatDate(o.estimatedCloseDate)}
                formatDraft={(value) => (value ? formatDate(value) : "—")}
                type="date"
                title="Click to edit estimated close date"
                className="flex w-full items-center justify-between gap-2"
                onSave={(next) => onSave({ estimatedCloseDate: next || null })}
              />
            ) : (
              formatDate(o.estimatedCloseDate)
            )}
          </AnalysisRow>
        </AnalysisSection>
      </div>
    </div>
  )
}
