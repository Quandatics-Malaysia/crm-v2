import { requireContext } from "@/lib/server-context"
import {
  listAccountOptions,
  listMembers,
  listFunnelsWithStages,
} from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { listOpportunities, listPersonsWithAccount } from "./actions"
import { OpportunitiesBoard } from "./opportunities-board"
import { OpportunitiesTable } from "./opportunities-table"
import { OpportunityForm } from "./opportunity-form"

export default async function OpportunitiesPage() {
  const ctx = await requireContext()
  const [rows, accounts, persons, members, funnels] = await Promise.all([
    listOpportunities(),
    listAccountOptions(),
    listPersonsWithAccount(),
    listMembers(),
    listFunnelsWithStages(),
  ])

  const newButton = (
    <OpportunityForm
      mode="create"
      accounts={accounts}
      persons={persons}
      members={members}
      funnels={funnels}
      defaultOwnerMemberId={ctx.memberId}
    />
  )

  return (
    <>
      <SiteHeader title="Funnel" />
      <PageBody>
        <PageHeader
          title="Funnel"
          description="Track deals across your pipeline."
        >
          {newButton}
        </PageHeader>

        <Tabs defaultValue="board" className="w-full">
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="pt-2">
            <OpportunitiesBoard data={rows} funnels={funnels} />
          </TabsContent>

          <TabsContent value="list" className="pt-2">
            <OpportunitiesTable data={rows} />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  )
}
