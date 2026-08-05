import { notFound } from "next/navigation"

import { requireContext } from "@/lib/actions"
import { getSubscriptionAdminData } from "./actions"
import { SubscriptionClient } from "./subscription-client"

export default async function SubscriptionSettingsPage() {
  const ctx = await requireContext()
  if (!ctx.isSuperadmin) notFound()

  const data = await getSubscriptionAdminData()
  return <SubscriptionClient data={data} />
}
