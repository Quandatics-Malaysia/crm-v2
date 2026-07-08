import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { requireContext } from "@/lib/server-context"
import { requireModule } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import { listProjects } from "./actions"
import { ProjectsTable } from "./projects-table"

export default async function ProjectsPage() {
  requireModule("projects")
  const [rows, ctx] = await Promise.all([listProjects(), requireContext()])

  const newButton = ctx.can(PERMISSIONS.PROJECT_CREATE) ? (
    <Button nativeButton={false} render={<Link href="/projects/new" />}>New project</Button>
  ) : undefined

  return (
    <>
      <SiteHeader title="Projects" />
      <PageBody>
        <ProjectsTable data={rows} toolbar={newButton} />
      </PageBody>
    </>
  )
}
