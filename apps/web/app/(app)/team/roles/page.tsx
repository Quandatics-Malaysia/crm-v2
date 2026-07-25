import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listRolesWithPermissions, listPermissionAdmins } from "../actions"
import { RolesManager } from "./roles-manager"

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const [{ role: initialRoleId }, roles, admins] = await Promise.all([
    searchParams,
    listRolesWithPermissions(),
    listPermissionAdmins(),
  ])
  return (
    <>
      <SiteHeader
        title="Roles & permissions"
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: "Roles" }]}
      />
      <PageBody>
        <RolesManager roles={roles} admins={admins} initialRoleId={initialRoleId} />
      </PageBody>
    </>
  )
}
