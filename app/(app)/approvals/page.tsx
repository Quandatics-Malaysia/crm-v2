import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
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
        <ApprovalsClient incoming={incoming} mine={mine} />
      </PageBody>
    </>
  )
}
