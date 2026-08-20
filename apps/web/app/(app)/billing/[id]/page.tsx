import { notFound, redirect } from "next/navigation"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { requireEntitledRoute } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listEntityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { FINANCE_KINDS, type FinanceDocKind } from "@/lib/finance-kinds"
import { getFinanceDoc } from "../actions"
import { DocDetailBody } from "./doc-detail-body"

export default async function FinanceDocPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireEntitledRoute("finance")
  const ctx = await requireContext()
  if (!ctx.can(PERMISSIONS.FINANCE_VIEW)) redirect("/dashboard")

  const { id } = await params
  const detail = await getFinanceDoc(id)
  if (!detail) notFound()

  const [activity, documents] = await Promise.all([
    listActivities("finance_doc", id),
    listEntityDocuments("finance_doc", id),
  ])

  const meta = FINANCE_KINDS[detail.doc.kind as FinanceDocKind]

  return (
    <>
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
