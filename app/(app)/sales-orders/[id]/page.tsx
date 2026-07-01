import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { getSalesOrder } from "../actions"
import { SalesOrderDetailBody } from "./sales-order-detail-body"

export default async function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [order, ctx] = await Promise.all([getSalesOrder(id), requireContext()])
  if (!order) notFound()

  const canApprove = ctx.can(PERMISSIONS.SALES_ORDER_APPROVE)
  const canSubmit = ctx.can(PERMISSIONS.SALES_ORDER_SUBMIT)
  const title = order.soNumber ?? "Sales order"

  return (
    <>
      <SiteHeader
        title={title}
        breadcrumbs={[
          { label: "Sales orders", href: "/sales-orders" },
          { label: title },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {order.projectName}
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/sales-orders" />}
          >
            Back to sales orders
          </Button>
        </div>

        <SalesOrderDetailBody
          order={order}
          canApprove={canApprove}
          canSubmit={canSubmit}
        />
      </PageBody>
    </>
  )
}
