"use client"

import { useRouter } from "next/navigation"

import {
  QuotationCreateForm,
  type OpportunityOption,
  type ProductTypeOption,
} from "../quotation-create-form"
import type { TaxOption } from "../actions"

/**
 * Page wrapper around the shared {@link QuotationCreateForm}: keeps the funnel
 * picker visible and navigates to the new quotation on success.
 */
export function NewQuotationForm({
  opportunities,
  defaultOpportunityId,
  taxOptions,
  taxInclusive,
  productTypes,
}: {
  opportunities: OpportunityOption[]
  defaultOpportunityId?: string
  taxOptions: TaxOption[]
  taxInclusive: boolean
  productTypes: ProductTypeOption[]
}) {
  const router = useRouter()
  return (
    <QuotationCreateForm
      opportunities={opportunities}
      defaultOpportunityId={defaultOpportunityId}
      taxOptions={taxOptions}
      taxInclusive={taxInclusive}
      productTypes={productTypes}
      submitLabel="Create draft"
      onCancel={() => router.push("/quotations")}
      onCreated={(q) => router.push(`/quotations/${q.id}`)}
    />
  )
}
