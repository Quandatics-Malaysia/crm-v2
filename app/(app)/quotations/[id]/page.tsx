import Link from "next/link"
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { withTenant } from "@/lib/actions"
import { PERMISSIONS } from "@/lib/permissions"
import { tenantSettings } from "@/db/schema"
import { listTaxOptions } from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
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
  const [detail, taxOptions, taxInclusive, attachments, project] =
    await Promise.all([
      getQuotation(id),
      listTaxOptions(),
      getTaxInclusive(),
      listEntityAttachments("quotation", id),
      getProjectForQuotation(id),
    ])
  if (!detail) notFound()

  return (
    <>
      <SiteHeader title="Quotation" />
      <PageBody>
        <PageHeader
          title={detail.quotation.quoteNumber}
          description={detail.opportunityName ?? undefined}
        >
          <Badge className="capitalize">{detail.quotation.status}</Badge>
        </PageHeader>

        <div className="flex flex-wrap gap-2">
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
              View project ({project.projectCode})
            </Button>
          ) : null}
        </div>

        <QuotationForm
          detail={detail}
          taxOptions={taxOptions}
          taxInclusive={taxInclusive}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attachments</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <AttachmentsPanel
              attachableType="quotation"
              attachableId={id}
              items={attachments}
              revalidate={`/quotations/${id}`}
            />
            <p className="text-xs text-muted-foreground">
              Files attached here also appear on the funnel.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  )
}
