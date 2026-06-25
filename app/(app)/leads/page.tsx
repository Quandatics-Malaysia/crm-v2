import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listAccountOptions, listFunnelsWithStages } from "@/lib/lookups"
import { listLeads } from "./actions"
import { LeadsTable } from "./leads-table"

export default async function LeadsPage() {
  const [rows, accountOptions, funnels] = await Promise.all([
    listLeads(),
    listAccountOptions(),
    listFunnelsWithStages(),
  ])

  return (
    <>
      <SiteHeader title="Leads" />
      <PageBody>
        <PageHeader
          title="Leads"
          description="Capture, qualify, and convert inbound interest into customers."
        />
        <LeadsTable data={rows} accountOptions={accountOptions} funnels={funnels} />
      </PageBody>
    </>
  )
}
