import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Forbidden } from "@/components/forbidden"
import { getServerContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import {
  listIncomingApprovals,
  listMyApprovals,
  getApprovalGateInfo,
} from "./actions"
import { ApprovalsClient } from "./approvals-client"

export default async function ApprovalsPage() {
  // The nav hides Approvals from roles that take no part in the gate, but the
  // route itself is open (the actions only require a context, not a specific
  // permission). Mirror the nav client-side so a Viewer who lands here by URL
  // sees a friendly access-denied state rather than an empty approver workbench
  // implying access they lack. Approvers and requesters (anyone who can advance
  // a stage) still get the full page; the server actions remain the source of
  // truth and are unchanged.
  const ctx = await getServerContext()
  const canParticipate =
    !!ctx &&
    (ctx.can(PERMISSIONS.STAGE_ADVANCE_APPROVE) ||
      ctx.can(PERMISSIONS.STAGE_ADVANCE))

  if (!canParticipate) {
    return (
      <>
        <SiteHeader title="Approvals" />
        <PageBody>
          <Forbidden description="Approvals are handled by the approvers who sign off on stage advances and the people who request them. Your role doesn't take part in this workflow." />
        </PageBody>
      </>
    )
  }

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
