import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listQuotations, listOpportunityOptions } from "./actions"
import { QuotationsTable } from "./quotations-table"

export default async function QuotationsPage() {
  const [rows, opportunities] = await Promise.all([
    listQuotations(),
    listOpportunityOptions(),
  ])
  return (
    <>
      <SiteHeader title="Quotations" />
      <PageBody>
        <PageHeader
          title="Quotations"
          description="Priced proposals under your funnels."
        />
        <QuotationsTable data={rows} opportunities={opportunities} />
      </PageBody>
    </>
  )
}
