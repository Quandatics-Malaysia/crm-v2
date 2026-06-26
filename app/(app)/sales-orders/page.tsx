import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listSalesOrders } from "./actions"
import { SalesOrdersTable } from "./sales-orders-table"

export default async function SalesOrdersPage() {
  const [rows, ctx] = await Promise.all([listSalesOrders(), requireContext()])
  const canApprove = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)
  const canSubmit = ctx.can(PERMISSIONS.SALES_ORDER_SUBMIT)
  return (
    <>
      <SiteHeader title="Sales Orders" />
      <PageBody>
        <SalesOrdersTable
          data={rows}
          canApprove={canApprove}
          canSubmit={canSubmit}
        />
      </PageBody>
    </>
  )
}
