import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listPaymentMilestones } from "./actions"
import { PaymentMilestonesTable } from "./payment-milestones-table"

export default async function PaymentMilestonesPage() {
  const milestones = await listPaymentMilestones()

  return (
    <>
      <SiteHeader title="Payment Milestones" />
      <PageBody>
        <PaymentMilestonesTable data={milestones} />
      </PageBody>
    </>
  )
}
