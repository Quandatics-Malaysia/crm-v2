import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { getEntitledModuleMap } from "@/lib/modules.server"
import { tenantSettings } from "@/db/schema"
import { listTaxOptions, listProjectNatures, listProductOptions } from "@/lib/lookups"
import { PageBody } from "@/components/page-header"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import { getQuotation, getProjectForQuotation, getQuotationFormMeta } from "../actions"
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
  const detail = await getQuotation(id)
  if (!detail) notFound()

  const [
    taxOptions,
    taxInclusive,
    projectNatures,
    products,
    attachments,
    project,
    ctx,
    modules,
    formMeta,
  ] = await Promise.all([
    listTaxOptions(),
    getTaxInclusive(),
    listProjectNatures(),
    listProductOptions(),
    listEntityAttachments("quotation", id),
    getProjectForQuotation(id),
    requireContext(),
    getEntitledModuleMap(),
    getQuotationFormMeta(detail.quotation.funnelId),
  ])

  const perms = {
    canUpdate: ctx.can(PERMISSIONS.QUOTATION_UPDATE),
    canApprove: ctx.can(PERMISSIONS.QUOTATION_APPROVE),
    canSend: ctx.can(PERMISSIONS.QUOTATION_SEND),
    canAccept: ctx.can(PERMISSIONS.QUOTATION_ACCEPT),
    canDelete: ctx.can(PERMISSIONS.QUOTATION_DELETE),
    canCreateProject:
      modules.projects && ctx.can(PERMISSIONS.PROJECT_CREATE),
    canCreateRevision: ctx.can(PERMISSIONS.QUOTATION_CREATE),
  }

  return (
    <>
      <PageBody>
        <QuotationForm
          detail={detail}
          taxOptions={taxOptions}
          taxInclusive={taxInclusive}
          projectNatures={projectNatures}
          products={products}
          contacts={formMeta.contacts}
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
