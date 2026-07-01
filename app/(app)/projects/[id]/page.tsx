import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listEntityTimeline } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney } from "@/lib/format"
import { getProject, listMilestones } from "../actions"
import { listProjectSalesOrders } from "@/app/(app)/sales-orders/actions"
import { ProjectEditButton } from "./project-edit-button"
import { ProjectDetailBody } from "./project-detail-body"

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

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Status",
      value: (
        <Badge
          variant={statusVariant[project.status] ?? "secondary"}
          className="capitalize"
        >
          {project.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      label: "Value",
      value: (
        <span className="font-semibold tabular-nums">
          {project.value ? formatMoney(project.value, project.currency) : "—"}
        </span>
      ),
    },
    { label: "Start date", value: formatDate(project.startDate) },
    {
      label: "Account",
      value: accountName ? (
        <Link
          href={`/accounts/${project.accountId}`}
          className="font-medium link"
        >
          {accountName}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      label: "Funnel",
      value: project.opportunityId ? (
        <Link
          href={`/funnel/${project.opportunityId}`}
          className="font-medium link"
        >
          {opportunityName ?? "View funnel"}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      label: "Quotation",
      value: project.quotationId ? (
        <Link
          href={`/quotations/${project.quotationId}`}
          className="font-medium link"
        >
          {quotationNumber ?? "View quotation"}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Owner", value: ownerName ?? "—" },
  ]

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

        <ProjectDetailBody
          projectId={id}
          fields={fields}
          notes={project.notes}
          milestones={milestones}
          projectValue={project.value}
          currency={project.currency}
          canManage={canUpdate}
          salesOrders={salesOrders}
          canSubmit={canSubmitSO}
          canApprove={canApproveSO}
          activity={activity}
          documents={documents}
        />

        <div>
          <Button variant="outline" nativeButton={false} render={<Link href="/projects" />}>
            Back to projects
          </Button>
        </div>
      </PageBody>
    </>
  )
}
