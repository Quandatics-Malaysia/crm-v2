import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  listFunnelsWithStages,
  listMembers,
  listLeadSources,
  listLossReasons,
  getFormPresets,
} from "@/lib/lookups"
import { listLeads } from "./actions"
import { LeadsTable } from "./leads-table"

export default async function LeadsPage() {
  const [rows, pipelines, members, leadSources, lossReasons, presets] =
    await Promise.all([
      listLeads(),
      listFunnelsWithStages(),
      listMembers(),
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
          pipelines={pipelines}
          members={members}
          leadSources={leadSources}
          lossReasons={lossReasons}
          phonePrefix={presets.phonePrefix}
        />
      </PageBody>
    </>
  )
}
