import { getSettings, listTenantMembers } from "@/app/(app)/settings/actions"
import { PeopleClient } from "./people-client"

export default async function PeopleSettingsPage() {
  const [settings, members] = await Promise.all([
    getSettings(),
    listTenantMembers(),
  ])
  return <PeopleClient settings={settings} members={members} />
}
