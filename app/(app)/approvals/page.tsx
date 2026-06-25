import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listIncomingApprovals, listMyApprovals } from "./actions"
import { ApprovalsClient } from "./approvals-client"

export default async function ApprovalsPage() {
  const [incoming, mine] = await Promise.all([
    listIncomingApprovals(),
    listMyApprovals(),
  ])

  return (
    <>
      <SiteHeader title="Approvals" />
      <PageBody>
        <PageHeader
          title="Approvals"
          description="Review stage-advance requests routed to you and track the ones you raised."
        />
        <ApprovalsClient incoming={incoming} mine={mine} />
      </PageBody>
    </>
  )
}
