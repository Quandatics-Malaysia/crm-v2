import { requireContext } from "@/lib/server-context"
import {
  listAccountOptions,
  listMembers,
  listFunnelsWithStages,
} from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
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
        <Tabs defaultValue="board" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
            <TabsContent value="board" className="contents">
              {newButton}
            </TabsContent>
          </div>

          <TabsContent value="board" className="pt-2">
            <OpportunitiesBoard data={rows} funnels={funnels} />
          </TabsContent>

          <TabsContent value="list" className="pt-2">
            <OpportunitiesTable data={rows} toolbar={newButton} />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  )
}
