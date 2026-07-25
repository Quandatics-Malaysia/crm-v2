import { getSettings, listTenantMembers } from "@/app/(app)/settings/actions"
import { listEntities } from "@/lib/lookups"
import { GeneralClient } from "./general-client"

export default async function GeneralSettingsPage() {
  const [settings, members, entities] = await Promise.all([
    getSettings(),
    listTenantMembers(),
    listEntities(),
  ])
  return <GeneralClient settings={settings} members={members} entities={entities} />
}
