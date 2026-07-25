import { getSettings } from "@/app/(app)/settings/actions"
import { NumberingClient } from "./numbering-client"

export default async function NumberingSettingsPage() {
  const settings = await getSettings()
  return <NumberingClient settings={settings} />
}
