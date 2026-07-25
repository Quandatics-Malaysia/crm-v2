import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { requireModule } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import { listSalesOrders, listSubmittableProjects } from "./actions"
import { SalesOrdersTable } from "./sales-orders-table"

export default async function SalesOrdersPage() {
  requireModule("salesOrders")
  const [rows, ctx] = await Promise.all([listSalesOrders(), requireContext()])
  const canApprove = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)
  const canSubmit = ctx.can(PERMISSIONS.SALES_ORDER_SUBMIT)
  // Only fetch the project picker options when the user can actually submit.
  const projects = canSubmit ? await listSubmittableProjects() : []
  return (
    <>
      <SiteHeader title="Sales Orders" />
      <PageBody>
        <SalesOrdersTable
          data={rows}
          canApprove={canApprove}
          canSubmit={canSubmit}
          projects={projects}
        />
      </PageBody>
    </>
  )
}
