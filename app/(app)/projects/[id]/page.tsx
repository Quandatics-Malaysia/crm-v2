import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney } from "@/lib/format"
import { getProject } from "../actions"
import { ProjectEditButton } from "./project-edit-button"

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  planning: "outline",
  active: "default",
  on_hold: "secondary",
  completed: "secondary",
  cancelled: "destructive",
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getProject(id)
  if (!detail) notFound()

  const { project, accountName, opportunityName, quotationNumber, ownerName } =
    detail

  const [activity, files] = await Promise.all([
    listActivities("project", id),
    listEntityAttachments("project", id),
  ])

  const revalidate = `/projects/${id}`

  return (
    <>
      <SiteHeader title="Project" />
      <PageBody>
        <PageHeader
          title={project.name}
          description={project.projectCode}
        >
          <ProjectEditButton project={project} />
        </PageHeader>

        {/* Summary header */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 py-5">
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Code</span>
              <span className="font-mono text-sm font-semibold">
                {project.projectCode}
              </span>
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Status</span>
              <Badge
                variant={statusVariant[project.status] ?? "secondary"}
                className="capitalize"
              >
                {project.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Value</span>
              <span className="text-sm font-semibold tabular-nums">
                {project.value
                  ? formatMoney(project.value, project.currency)
                  : "—"}
              </span>
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Start date</span>
              <span className="text-sm">{formatDate(project.startDate)}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Account</span>
              {accountName ? (
                <Link
                  href={`/accounts/${project.accountId}`}
                  className="text-sm font-medium hover:underline"
                >
                  {accountName}
                </Link>
              ) : (
                <span className="text-sm">—</span>
              )}
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Funnel</span>
              {project.opportunityId ? (
                <Link
                  href={`/funnel/${project.opportunityId}`}
                  className="text-sm font-medium hover:underline"
                >
                  {opportunityName ?? "View funnel"}
                </Link>
              ) : (
                <span className="text-sm">—</span>
              )}
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Quotation</span>
              {project.quotationId ? (
                <Link
                  href={`/quotations/${project.quotationId}`}
                  className="text-sm font-medium hover:underline"
                >
                  {quotationNumber ?? "View quotation"}
                </Link>
              ) : (
                <span className="text-sm">—</span>
              )}
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Owner</span>
              <span className="text-sm">{ownerName ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {project.notes ? (
          <Card>
            <CardContent className="py-5">
              <span className="text-xs text-muted-foreground">Notes</span>
              <p className="mt-1 text-sm whitespace-pre-wrap">{project.notes}</p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <ActivityTimeline
            entityType="project"
            entityId={id}
            items={activity}
            revalidate={revalidate}
          />
          <AttachmentsPanel
            attachableType="project"
            attachableId={id}
            items={files}
            revalidate={revalidate}
          />
        </div>

        <div>
          <Button variant="outline" nativeButton={false} render={<Link href="/projects" />}>
            Back to projects
          </Button>
        </div>
      </PageBody>
    </>
  )
}
