import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listQuotations, listOpportunityOptions } from "./actions"
import { QuotationsTable } from "./quotations-table"

export default async function QuotationsPage() {
  const [rows, opportunities, ctx] = await Promise.all([
    listQuotations(),
    listOpportunityOptions(),
    requireContext(),
  ])
  const canCreate = ctx.can(PERMISSIONS.QUOTATION_CREATE)
  return (
    <>
      <SiteHeader title="Quotations" />
      <PageBody>
        <QuotationsTable
          data={rows}
          opportunities={opportunities}
          canCreate={canCreate}
        />
      </PageBody>
    </>
  )
}
