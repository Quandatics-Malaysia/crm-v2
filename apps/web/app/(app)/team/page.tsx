import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listTeamMembers, listTeamRoles, listPendingInvites } from "./actions"
import { TeamClient } from "./team-client"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { getEntitledModuleMap } from "@/lib/modules.server"

export default async function TeamPage() {
  const [ctx, members, roles, invites, modules] = await Promise.all([
    requireContext(),
    listTeamMembers(),
    listTeamRoles(),
    listPendingInvites(),
    getEntitledModuleMap(),
  ])

  return (
    <>
      <SiteHeader title="Team" />
      <PageBody>
        <TeamClient
          members={members}
          roles={roles}
          invites={invites}
          canManageUsers={ctx.can(PERMISSIONS.TENANT_MANAGE_USERS)}
          advancedRoles={modules.advancedRoles}
        />
      </PageBody>
    </>
  )
}
