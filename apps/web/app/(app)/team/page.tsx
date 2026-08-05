import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listTeamMembers, listTeamRoles, listPendingInvites } from "./actions"
import { TeamClient } from "./team-client"
import { requireContext } from "@/lib/server-context"

export default async function TeamPage() {
  const [ctx, members, roles, invites] = await Promise.all([
    requireContext(),
    listTeamMembers(),
    listTeamRoles(),
    listPendingInvites(),
  ])

  return (
    <>
      <SiteHeader title="Team" />
      <PageBody>
        <TeamClient members={members} roles={roles} invites={invites} isSuperadmin={ctx.isSuperadmin} />
      </PageBody>
    </>
  )
}
