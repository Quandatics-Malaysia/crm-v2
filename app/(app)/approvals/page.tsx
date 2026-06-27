import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  listIncomingApprovals,
  listMyApprovals,
  getApprovalGateInfo,
} from "./actions"
import { ApprovalsClient } from "./approvals-client"

export default async function ApprovalsPage() {
  const [incoming, mine, gate] = await Promise.all([
    listIncomingApprovals(),
    listMyApprovals(),
    getApprovalGateInfo(),
  ])

  return (
    <>
      <SiteHeader title="Approvals" />
      <PageBody>
        <ApprovalsClient
          incoming={incoming}
          mine={mine}
          bypassTier={gate.bypassTier}
        />
      </PageBody>
    </>
  )
}
