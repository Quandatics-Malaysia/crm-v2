import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listOpportunities } from "./actions"
import { OpportunitiesTable } from "./opportunities-table"

export default async function OpportunitiesPage() {
  const opportunities = await listOpportunities()
  return (
    <>
      <SiteHeader title="Opportunities" />
      <PageBody>
        <OpportunitiesTable data={opportunities} />
      </PageBody>
    </>
  )
}
