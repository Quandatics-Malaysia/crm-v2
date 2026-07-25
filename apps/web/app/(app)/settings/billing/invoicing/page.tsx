import { getSettings } from "@/app/(app)/settings/actions"
import { InvoicingClient } from "./invoicing-client"

export default async function InvoicingSettingsPage() {
  const settings = await getSettings()
  return <InvoicingClient settings={settings} />
}
