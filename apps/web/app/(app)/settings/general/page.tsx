import { getSettings, listTenantMembers } from "@/app/(app)/settings/actions"
import { GeneralClient } from "./general-client"

export default async function GeneralSettingsPage() {
  const [settings, members] = await Promise.all([
    getSettings(),
    listTenantMembers(),
  ])
  return <GeneralClient settings={settings} members={members} />
}
