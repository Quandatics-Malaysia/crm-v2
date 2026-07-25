import { getSettings } from "@/app/(app)/settings/actions"
import { IndustriesClient } from "./industries-client"

export default async function IndustriesSettingsPage() {
  const settings = await getSettings()
  return <IndustriesClient settings={settings} />
}
