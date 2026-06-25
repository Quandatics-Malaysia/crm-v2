import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listOpportunityOptions } from "../actions"
import { QuotationCreateForm } from "./quotation-create-form"

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>
}) {
  const sp = await searchParams
  const opportunities = await listOpportunityOptions()

  // Prefill from the query when the funnel still exists.
  const defaultOpportunityId = opportunities.some((o) => o.id === sp.opportunityId)
    ? sp.opportunityId
    : undefined

  return (
    <>
      <SiteHeader title="New quotation" />
      <PageBody>
        <PageHeader title="New quotation" />
        <QuotationCreateForm
          opportunities={opportunities}
          defaultOpportunityId={defaultOpportunityId}
        />
      </PageBody>
    </>
  )
}
