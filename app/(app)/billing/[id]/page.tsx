import { notFound, redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { FINANCE_KINDS, type FinanceDocKind } from "@/lib/finance-kinds"
import { getFinanceDoc, isFinanceEnabled } from "../actions"
import { DocDetailBody } from "./doc-detail-body"

export default async function FinanceDocPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const enabled = await isFinanceEnabled().catch(() => false)
  if (!enabled) redirect("/dashboard")

  const detail = await getFinanceDoc(id)
  if (!detail) notFound()

  const [ctx, activity, documents] = await Promise.all([
    requireContext(),
    listActivities("finance_doc", id),
    listEntityDocuments("finance_doc", id),
  ])

  const meta = FINANCE_KINDS[detail.doc.kind as FinanceDocKind]
  const backHref = meta.direction === "sale" ? "/billing" : "/purchasing"
  const backLabel = meta.direction === "sale" ? "Billing" : "Purchasing"

  return (
    <>
      <SiteHeader
        title={detail.doc.number}
        breadcrumbs={[
          { label: backLabel, href: backHref },
          { label: detail.doc.number },
        ]}
      />
      <PageBody>
        <DocDetailBody
          detail={detail}
          activity={activity}
          documents={documents}
          canManage={ctx.can(PERMISSIONS.FINANCE_MANAGE)}
        />
      </PageBody>
    </>
  )
}
