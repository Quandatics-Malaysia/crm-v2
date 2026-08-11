import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listRolesWithPermissions, listPermissionAdmins } from "../actions"
import { RolesManager } from "./roles-manager"
import { requireEntitledRoute } from "@/lib/module-guard"
import { getEntitledModuleMap } from "@/lib/modules.server"
import { getPermissionGroups } from "@/lib/permissions"

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  await requireEntitledRoute("advancedRoles")
  const [{ role: initialRoleId }, roles, admins, modules] = await Promise.all([
    searchParams,
    listRolesWithPermissions(),
    listPermissionAdmins(),
    getEntitledModuleMap(),
  ])
  return (
    <>
      <SiteHeader
        title="Roles & permissions"
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: "Roles" }]}
      />
      <PageBody>
        <RolesManager
          roles={roles}
          admins={admins}
          initialRoleId={initialRoleId}
          permissionGroups={getPermissionGroups(modules)}
        />
      </PageBody>
    </>
  )
}
