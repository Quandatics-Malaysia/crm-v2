"use client"

import { useRouter } from "next/navigation"

import {
  QuotationCreateForm,
  type OpportunityOption,
  type ProjectNatureOption,
} from "../quotation-create-form"
import type { QuotationContactOption, TaxOption } from "../actions"
import type { ProductOption } from "@/lib/lookups"

/**
 * Page wrapper around the shared {@link QuotationCreateForm}: keeps the funnel
 * picker visible and navigates to the new quotation on success.
 */
export function NewQuotationForm({
  funnels,
  defaultOpportunityId,
  taxOptions,
  taxInclusive,
  projectNatures,
  products,
  currencies,
  defaultValidUntil,
  contacts,
  defaultAttentionContactId,
  quoteDefaults,
}: {
  funnels: OpportunityOption[]
  defaultOpportunityId?: string
  taxOptions: TaxOption[]
  taxInclusive: boolean
  projectNatures: ProjectNatureOption[]
  products: ProductOption[]
  currencies: string[]
  /** Tenant default "Valid until" prefill (Settings → Numbering). */
  defaultValidUntil?: string | null
  contacts: QuotationContactOption[]
  defaultAttentionContactId: string | null
  quoteDefaults: { notes: string | null; delivery: string | null; paymentTerm: string | null }
}) {
  const router = useRouter()
  return (
    <QuotationCreateForm
      funnels={funnels}
      defaultOpportunityId={defaultOpportunityId}
      taxOptions={taxOptions}
      taxInclusive={taxInclusive}
      projectNatures={projectNatures}
      products={products}
      currencies={currencies}
      defaultValidUntil={defaultValidUntil}
      contacts={contacts}
      defaultAttentionContactId={defaultAttentionContactId}
      quoteDefaults={quoteDefaults}
      submitLabel="Create draft"
      onCancel={() => router.push("/quotations")}
      onCreated={(q) => router.push(`/quotations/${q.id}`)}
    />
  )
}
