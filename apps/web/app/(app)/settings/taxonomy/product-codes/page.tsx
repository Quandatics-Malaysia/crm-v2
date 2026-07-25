import { getSettings } from "@/app/(app)/settings/actions"
import { ProductCodesClient } from "./product-codes-client"

export default async function ProductCodesSettingsPage() {
  const settings = await getSettings()
  return <ProductCodesClient settings={settings} />
}
