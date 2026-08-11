import { getSettings } from "@/app/(app)/settings/actions"
import { InvoicingClient } from "./invoicing-client"
import { requireEntitledRoute } from "@/lib/module-guard"

export default async function InvoicingSettingsPage() {
  await requireEntitledRoute("finance")
  const settings = await getSettings()
  return <InvoicingClient settings={settings} />
}
