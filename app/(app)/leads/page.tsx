import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  listAccountOptions,
  listFunnelsWithStages,
  listMembers,
  listCountries,
} from "@/lib/lookups"
import { listLeads } from "./actions"
import { LeadsTable } from "./leads-table"

export default async function LeadsPage() {
  const [rows, accountOptions, funnels, members, countries] = await Promise.all([
    listLeads(),
    listAccountOptions(),
    listFunnelsWithStages(),
    listMembers(),
    listCountries(),
  ])

  return (
    <>
      <SiteHeader title="Leads" />
      <PageBody>
        <LeadsTable
          data={rows}
          accountOptions={accountOptions}
          funnels={funnels}
          members={members}
          countries={countries}
        />
      </PageBody>
    </>
  )
}
