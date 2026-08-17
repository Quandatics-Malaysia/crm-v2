import { getSettings } from "@/app/(app)/settings/actions"
import { DocumentsClient } from "./documents-client"

export default async function DocumentsSettingsPage() {
  const settings = await getSettings()
  return <DocumentsClient settings={settings} />
}
