import { getSettings } from "@/app/(app)/settings/actions"
import { NumberingClient } from "./numbering-client"
import { requireEntitledRoute } from "@/lib/module-guard"

export default async function NumberingSettingsPage() {
  await requireEntitledRoute("finance")
  const settings = await getSettings()
  return <NumberingClient settings={settings} />
}
