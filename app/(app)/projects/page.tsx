import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { listProjects } from "./actions"
import { ProjectsTable } from "./projects-table"

export default async function ProjectsPage() {
  const rows = await listProjects()

  const newButton = (
    <Button nativeButton={false} render={<Link href="/projects/new" />}>New project</Button>
  )

  return (
    <>
      <SiteHeader title="Projects" />
      <PageBody>
        <ProjectsTable data={rows} toolbar={newButton} />
      </PageBody>
    </>
  )
}
