import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listEntityTimeline } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney } from "@/lib/format"
import { getProject, listMilestones, listQuotationLinkOptions } from "../actions"
import { listProjectSalesOrders } from "@/app/(app)/sales-orders/actions"
import { getProjectBillingSummary } from "@/app/(app)/billing/actions"
import { ProjectEditButton } from "./project-edit-button"
import { ProjectDetailBody } from "./project-detail-body"

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

  const [activity, documents, milestones, salesOrders, ctx, billing] =
    await Promise.all([
      listEntityTimeline("project", id),
      listEntityDocuments("project", id),
      listMilestones(id),
      listProjectSalesOrders(id),
      requireContext(),
      // Null when the finance module is off (or user lacks finance.view).
      getProjectBillingSummary(id).catch(() => null),
    ])

  const canUpdate = detail.canEdit && ctx.can(PERMISSIONS.PROJECT_UPDATE)
  const canSubmitSO = ctx.can(PERMISSIONS.SALES_ORDER_SUBMIT)
  const canApproveSO = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)

  // Quotations linkable to this project = those under its funnel. Empty when the
  // project has no funnel (nothing to link) or the user can't edit.
  const quotationOptions =
    canUpdate && project.opportunityId
      ? await listQuotationLinkOptions(project.opportunityId)
      : []

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Status",
      value: <StatusBadge status={project.status} />,
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
            {canUpdate ? (
              <ProjectEditButton
                project={project}
                quotationOptions={quotationOptions}
              />
            ) : null}
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
          billing={billing}
          canManageFinance={ctx.can(PERMISSIONS.FINANCE_MANAGE)}
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
