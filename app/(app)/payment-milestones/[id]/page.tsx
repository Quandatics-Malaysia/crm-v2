import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { formatMoney } from "@/lib/format"
import { getPaymentMilestone } from "../actions"
import { PaymentMilestoneDetailBody } from "../payment-milestone-detail-body"

export default async function PaymentMilestoneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const milestone = await getPaymentMilestone(id)
  if (!milestone) notFound()

  return (
    <>
      <SiteHeader
        title={milestone.title}
        breadcrumbs={[
          { label: "Payment Milestones", href: "/payment-milestones" },
          { label: milestone.title },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {milestone.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatMoney(milestone.amount)}
            </p>
          </div>
        </div>

        <PaymentMilestoneDetailBody milestone={milestone} />
      </PageBody>
    </>
  )
}
