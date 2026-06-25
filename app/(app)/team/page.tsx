import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listTeamMembers, listTeamRoles } from "./actions"
import { TeamClient } from "./team-client"

export default async function TeamPage() {
  const [members, roles] = await Promise.all([
    listTeamMembers(),
    listTeamRoles(),
  ])

  return (
    <>
      <SiteHeader title="Team" />
      <PageBody>
        <TeamClient members={members} roles={roles} />
      </PageBody>
    </>
  )
}
