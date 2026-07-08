import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  listAccountOptions,
  listFunnelsWithStages,
  listMembers,
  listCountries,
  listLeadSources,
  listLossReasons,
  getFormPresets,
} from "@/lib/lookups"
import { listLeads } from "./actions"
import { LeadsTable } from "./leads-table"

export default async function LeadsPage() {
  const [
    rows,
    accountOptions,
    pipelines,
    members,
    countries,
    leadSources,
    lossReasons,
    presets,
  ] = await Promise.all([
    listLeads(),
    listAccountOptions(),
    listFunnelsWithStages(),
    listMembers(),
    listCountries(),
    listLeadSources(),
    listLossReasons(),
    getFormPresets(),
  ])

  return (
    <>
      <SiteHeader title="Leads" />
      <PageBody>
        <LeadsTable
          data={rows}
          accountOptions={accountOptions}
          pipelines={pipelines}
          members={members}
          countries={countries}
          leadSources={leadSources}
          lossReasons={lossReasons}
          phonePrefix={presets.phonePrefix}
        />
      </PageBody>
    </>
  )
}
