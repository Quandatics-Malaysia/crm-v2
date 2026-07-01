"use client"

import { useRouter } from "next/navigation"

import {
  QuotationCreateForm,
  type OpportunityOption,
  type ProjectNatureOption,
} from "../quotation-create-form"
import type { TaxOption } from "../actions"
import type { ProductOption } from "@/lib/lookups"

/**
 * Page wrapper around the shared {@link QuotationCreateForm}: keeps the funnel
 * picker visible and navigates to the new quotation on success.
 */
export function NewQuotationForm({
  opportunities,
  defaultOpportunityId,
  taxOptions,
  taxInclusive,
  projectNatures,
  products,
}: {
  opportunities: OpportunityOption[]
  defaultOpportunityId?: string
  taxOptions: TaxOption[]
  taxInclusive: boolean
  projectNatures: ProjectNatureOption[]
  products: ProductOption[]
}) {
  const router = useRouter()
  return (
    <QuotationCreateForm
      opportunities={opportunities}
      defaultOpportunityId={defaultOpportunityId}
      taxOptions={taxOptions}
      taxInclusive={taxInclusive}
      projectNatures={projectNatures}
      products={products}
      submitLabel="Create draft"
      onCancel={() => router.push("/quotations")}
      onCreated={(q) => router.push(`/quotations/${q.id}`)}
    />
  )
}
