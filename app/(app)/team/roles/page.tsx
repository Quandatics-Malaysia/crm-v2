import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listRolesWithPermissions } from "../actions"
import { RolesManager } from "./roles-manager"

export default async function RolesPage() {
  const roles = await listRolesWithPermissions()
  return (
    <>
      <SiteHeader
        title="Roles & permissions"
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: "Roles" }]}
      />
      <PageBody>
        <RolesManager roles={roles} />
      </PageBody>
    </>
  )
}
