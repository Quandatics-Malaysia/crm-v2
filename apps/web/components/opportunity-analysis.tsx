"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { FieldRow } from "@/components/detail-page"
import { InlineCombobox } from "@/components/inline-combobox"
import { InlineValue } from "@/components/inline-value"
import { formatDate, formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
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
    <section className="grid gap-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left text-sm font-semibold"
      >
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !open && "-rotate-90"
          )}
        />
        {title}
      </button>
      {open ? (
        <div className="grid gap-3">{children}</div>
      ) : null}
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
    <FieldRow inline label={label}>
      {children}
    </FieldRow>
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
    <span className="link">{contact.name}</span>
  ) : (
    "—"
  )

  return (
    <div className="grid gap-5">
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
              onSave={(next) => onSave({ estimatedCloseDate: next || null })}
            />
          ) : (
            formatDate(o.estimatedCloseDate)
          )}
        </AnalysisRow>
      </AnalysisSection>
    </div>
  )
}
