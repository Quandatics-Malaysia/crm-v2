import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { listOpportunityOptions, getQuotationFormMeta } from "../actions"
import { NewQuotationForm } from "./new-quotation-form"

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>
}) {
  const sp = await searchParams
  const [opportunities, meta] = await Promise.all([
    listOpportunityOptions(),
    getQuotationFormMeta(),
  ])

  // Prefill from the query when the funnel still exists.
  const defaultOpportunityId = opportunities.some((o) => o.id === sp.opportunityId)
    ? sp.opportunityId
    : undefined

  return (
    <>
      <SiteHeader title="New quotation" />
      <PageBody>
        <PageHeader title="New quotation" />
        <Card className="max-w-2xl">
          <CardContent>
            <NewQuotationForm
              opportunities={opportunities}
              defaultOpportunityId={defaultOpportunityId}
              taxOptions={meta.taxOptions}
              taxInclusive={meta.taxInclusive}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  )
}
