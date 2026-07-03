import { redirect } from "next/navigation"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  isFinanceEnabled,
  listFinanceDocs,
  listFinanceSources,
  getReminderSchedule,
} from "./actions"
import { FinanceDocsTable } from "./finance-docs-table"

export default async function BillingPage() {
  const enabled = await isFinanceEnabled().catch(() => false)
  if (!enabled) redirect("/dashboard")
  const ctx = await requireContext()
  // Sources feed the create dialog only — a manager-level payload.
  const canManage = ctx.can(PERMISSIONS.FINANCE_MANAGE)
  const [docs, sources, reminderSchedule] = await Promise.all([
    listFinanceDocs("sale"),
    canManage
      ? listFinanceSources()
      : Promise.resolve({ salesOrders: [], docs: [], milestones: [] }),
    getReminderSchedule(),
  ])

  return (
    <>
      <SiteHeader title="Billing" />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          Customer documents, chained from the approved sales order: delivery
          order (optional) → invoice → credit note / payment receipt. Issuing a
          receipt settles its invoice and marks the linked milestone paid.
        </p>
        <FinanceDocsTable
          direction="sale"
          data={docs}
          sources={sources}
          reminderSchedule={reminderSchedule}
        />
      </PageBody>
    </>
  )
}
