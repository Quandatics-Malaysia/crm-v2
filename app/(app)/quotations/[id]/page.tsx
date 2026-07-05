import Link from "next/link"
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { tenantSettings } from "@/db/schema"
import { listTaxOptions, listProjectNatures, listProductOptions } from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import { getQuotation, getProjectForQuotation } from "../actions"
import { QuotationForm } from "../quotation-form"

async function getTaxInclusive(): Promise<boolean> {
  return withTenant(PERMISSIONS.QUOTATION_VIEW, async (tx, ctx) => {
    const [s] = await tx
      .select({ taxInclusive: tenantSettings.taxInclusive })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, ctx.tenantId))
      .limit(1)
    return s?.taxInclusive ?? false
  })
}

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [
    detail,
    taxOptions,
    taxInclusive,
    projectNatures,
    products,
    attachments,
    project,
    ctx,
  ] = await Promise.all([
    getQuotation(id),
    listTaxOptions(),
    getTaxInclusive(),
    listProjectNatures(),
    listProductOptions(),
    listEntityAttachments("quotation", id),
    getProjectForQuotation(id),
    requireContext(),
  ])
  if (!detail) notFound()

  const perms = {
    canUpdate: ctx.can(PERMISSIONS.QUOTATION_UPDATE),
    canSend: ctx.can(PERMISSIONS.QUOTATION_SEND),
    canAccept: ctx.can(PERMISSIONS.QUOTATION_ACCEPT),
    canDelete: ctx.can(PERMISSIONS.QUOTATION_DELETE),
    canCreateProject: ctx.can(PERMISSIONS.PROJECT_CREATE),
  }

  return (
    <>
      <SiteHeader
        title={detail.quotation.quoteNumber}
        breadcrumbs={[
          { label: "Quotations", href: "/quotations" },
          { label: detail.quotation.quoteNumber },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {detail.quotation.quoteNumber}
            </h2>
            {detail.opportunityName ? (
              <Link
                href={`/funnel/${detail.quotation.opportunityId}`}
                className="text-sm link"
              >
                {detail.opportunityName}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={detail.quotation.status}
              className="capitalize"
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/quotations/${detail.quotation.id}/preview`} />}
            >
              Preview / Print
            </Button>
            {detail.accountId ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/accounts/${detail.accountId}`} />}
              >
                View account
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/funnel/${detail.quotation.opportunityId}`} />}
            >
              View funnel
            </Button>
            {project ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/projects/${project.id}`} />}
              >
                View project (
                <span className="font-mono">{project.projectCode}</span>)
              </Button>
            ) : null}
          </div>
        </div>

        <QuotationForm
          detail={detail}
          taxOptions={taxOptions}
          taxInclusive={taxInclusive}
          projectNatures={projectNatures}
          products={products}
          project={
            project ? { id: project.id, projectCode: project.projectCode } : null
          }
          documents={attachments.map((a) => ({
            ...a,
            source: "Quotation",
            ownedHere: true,
          }))}
          perms={perms}
        />
      </PageBody>
    </>
  )
}
