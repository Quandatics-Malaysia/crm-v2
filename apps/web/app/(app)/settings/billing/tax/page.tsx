import { listTaxSettings } from "./actions"
import { TaxClient } from "./tax-client"
import { requireEntitledRoute } from "@/lib/module-guard"

export default async function TaxSettingsPage() {
  await requireEntitledRoute("finance")
  const data = await listTaxSettings()
  return <TaxClient data={data} />
}
