import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listQuotations } from "./actions"
import { QuotationsTable } from "./quotations-table"

export default async function QuotationsPage() {
  const [rows, ctx] = await Promise.all([listQuotations(), requireContext()])
  const canCreate = ctx.can(PERMISSIONS.QUOTATION_CREATE)
  return (
    <>
      <SiteHeader title="Quotations" />
      <PageBody>
        <QuotationsTable data={rows} canCreate={canCreate} />
      </PageBody>
    </>
  )
}
