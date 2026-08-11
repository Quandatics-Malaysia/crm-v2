import { redirect } from "next/navigation"
import { requireEntitledRoute } from "@/lib/module-guard"

export default async function BillingIndex() {
  await requireEntitledRoute("finance")
  redirect("/settings/billing/numbering")
}
