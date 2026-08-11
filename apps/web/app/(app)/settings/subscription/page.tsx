import { getSubscriptionEntitlementData } from "./actions"
import { SubscriptionClient } from "./subscription-client"

export default async function SubscriptionSettingsPage() {
  const data = await getSubscriptionEntitlementData()
  return <SubscriptionClient data={data} />
}
