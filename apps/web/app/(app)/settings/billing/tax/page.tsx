import { listTaxSettings } from "./actions"
import { TaxClient } from "./tax-client"

export default async function TaxSettingsPage() {
  const data = await listTaxSettings()
  return <TaxClient data={data} />
}
