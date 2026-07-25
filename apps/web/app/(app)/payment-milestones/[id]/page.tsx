import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { formatMoney } from "@/lib/format"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listMilestoneFinanceDocs } from "@/app/(app)/billing/actions"
import { getPaymentMilestone } from "../actions"
import { PaymentMilestoneDetailBody } from "../payment-milestone-detail-body"

export default async function PaymentMilestoneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [milestone, financeDocs, ctx] = await Promise.all([
    getPaymentMilestone(id),
    // Empty when the finance module is off (or user lacks finance.view).
    listMilestoneFinanceDocs(id).catch(() => []),
    requireContext(),
  ])
  if (!milestone) notFound()

  // Inline editing goes through updateFunnelMilestone, which only handles
  // funnel-attached milestones — project-only rows stay read-only here.
  const canManage =
    ctx.can(PERMISSIONS.PAYMENT_MILESTONE_MANAGE) && !!milestone.funnelId

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

        <PaymentMilestoneDetailBody
          milestone={milestone}
          financeDocs={financeDocs}
          canManage={canManage}
        />
      </PageBody>
    </>
  )
}
