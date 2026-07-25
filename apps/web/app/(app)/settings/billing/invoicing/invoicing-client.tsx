"use client"

import { PicklistCard } from "@/components/picklist-card"
import {
  updatePaymentTerms,
  updateSoDocumentKinds,
  updateInvoiceReminderDays,
  type TenantSettingsView,
} from "@/app/(app)/settings/actions"
import { DEFAULT_PAYMENT_TERMS, DEFAULT_SO_DOCUMENT_KINDS } from "@/lib/tenant-defaults"

export function InvoicingClient({ settings }: { settings: TenantSettingsView }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <PicklistCard
          title="Payment terms"
          description="Terms offered when submitting a sales order."
          items={settings.paymentTerms}
          defaults={DEFAULT_PAYMENT_TERMS}
          placeholder="e.g. 30 days"
          save={updatePaymentTerms}
        />
        <PicklistCard
          title="Sales-order document kinds"
          description="What a submitted supporting document can be identified as."
          items={settings.soDocumentKinds}
          defaults={DEFAULT_SO_DOCUMENT_KINDS}
          placeholder="e.g. PO"
          save={updateSoDocumentKinds}
        />
      </div>

      {settings.financeEnabled ? (
        <PicklistCard
          title="Invoice reminders"
          description="Days AFTER the due date at which reminder 1, 2, 3… become due on the dashboard and billing pages. Empty = the built-in 7 / 14 / 30."
          items={settings.invoiceReminderDays.map(String)}
          defaults={["7", "14", "30"]}
          placeholder="e.g. 7"
          validate={(v) =>
            Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 365
              ? null
              : "Enter days as a whole number (1–365)."
          }
          save={updateInvoiceReminderDays}
        />
      ) : null}
    </div>
  )
}
