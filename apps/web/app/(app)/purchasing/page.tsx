import { redirect } from "next/navigation"
import { requireContext } from "@/lib/server-context"
import { requireModule } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  listFinanceDocs,
  listFinanceSources,
  getReminderSchedule,
} from "@/app/(app)/billing/actions"
import { FinanceDocsTable } from "@/app/(app)/billing/finance-docs-table"

export default async function PurchasingPage() {
  requireModule("finance")
  const ctx = await requireContext()
  if (!ctx.can(PERMISSIONS.FINANCE_VIEW)) redirect("/dashboard")
  // Sources feed the create dialog only — a manager-level payload.
  const canManage = ctx.can(PERMISSIONS.FINANCE_MANAGE)
  const [docs, sources, reminderSchedule] = await Promise.all([
    listFinanceDocs("purchase"),
    canManage
      ? listFinanceSources()
      : Promise.resolve({ salesOrders: [], docs: [], milestones: [] }),
    getReminderSchedule(),
  ])

  return (
    <>
      <SiteHeader title="Purchasing" />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          Supplier documents, chained from the approved sales order: RFQ or
          direct purchase order → purchase invoice → payment. Issuing a payment
          settles its purchase invoice.
        </p>
        <FinanceDocsTable
          direction="purchase"
          data={docs}
          sources={sources}
          reminderSchedule={reminderSchedule}
        />
      </PageBody>
    </>
  )
}
