import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listTeamMembers, listTeamRoles, listPendingInvites } from "./actions"
import { TeamClient } from "./team-client"

export default async function TeamPage() {
  const [members, roles, invites] = await Promise.all([
    listTeamMembers(),
    listTeamRoles(),
    listPendingInvites(),
  ])

  return (
    <>
      <SiteHeader title="Team" />
      <PageBody>
        <TeamClient members={members} roles={roles} invites={invites} />
      </PageBody>
    </>
  )
}
