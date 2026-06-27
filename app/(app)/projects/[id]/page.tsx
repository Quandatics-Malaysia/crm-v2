import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listEntityTimeline } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney } from "@/lib/format"
import { getProject, listMilestones } from "../actions"
import { listProjectSalesOrders } from "@/app/(app)/sales-orders/actions"
import { ProjectSalesOrders } from "@/app/(app)/sales-orders/project-sales-orders"
import { ProjectEditButton } from "./project-edit-button"
import { MilestonesPanel } from "./milestones-panel"

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

  const [activity, documents, milestones, salesOrders, ctx] = await Promise.all([
    listEntityTimeline("project", id),
    listEntityDocuments("project", id),
    listMilestones(id),
    listProjectSalesOrders(id),
    requireContext(),
  ])

  const canUpdate = ctx.can(PERMISSIONS.PROJECT_UPDATE)
  const canSubmitSO = ctx.can(PERMISSIONS.SALES_ORDER_SUBMIT)
  const canApproveSO = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)

  const revalidate = `/projects/${id}`

  return (
    <>
      <SiteHeader
        title={project.projectCode}
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.projectCode },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {project.name}
            </h2>
            <p className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
              {project.projectCode}
              <span className="rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {project.codeNature === "manual" ? "Manual" : "Auto"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate ? <ProjectEditButton project={project} /> : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4">
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
                  <span className="text-xs text-muted-foreground">
                    Start date
                  </span>
                  <span className="text-sm">
                    {formatDate(project.startDate)}
                  </span>
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
                  <span className="text-xs text-muted-foreground">
                    Quotation
                  </span>
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

            <Card>
              <CardHeader>
                <CardTitle>Payment milestones</CardTitle>
              </CardHeader>
              <CardContent>
                <MilestonesPanel
                  projectId={id}
                  milestones={milestones}
                  projectValue={project.value}
                  currency={project.currency}
                  canManage={canUpdate}
                />
              </CardContent>
            </Card>

            {/* The panel renders its own "Sales orders" heading + submit
                action, so this card intentionally omits a CardTitle to avoid a
                doubled heading. */}
            <Card>
              <CardContent className="pt-6">
                <ProjectSalesOrders
                  projectId={id}
                  orders={salesOrders}
                  canSubmit={canSubmitSO}
                  canApprove={canApproveSO}
                />
              </CardContent>
            </Card>

            {project.notes ? (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{project.notes}</p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityTimeline
                  entityType="project"
                  entityId={id}
                  items={activity}
                  revalidate={revalidate}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentsSection
                  uploadType="project"
                  uploadId={id}
                  documents={documents}
                  revalidate={revalidate}
                />
              </CardContent>
            </Card>
          </div>
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
