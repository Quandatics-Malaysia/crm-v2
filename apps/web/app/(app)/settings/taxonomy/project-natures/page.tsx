import { getSettings } from "@/app/(app)/settings/actions"
import { ProjectNaturesClient } from "./project-natures-client"

export default async function ProjectNaturesSettingsPage() {
  const settings = await getSettings()
  return <ProjectNaturesClient settings={settings} />
}
