import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  getSettings,
  listTenantMembers,
  getDefaultFunnel,
} from "./actions"
import { listEntities } from "@/lib/lookups"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  const [settings, members, funnel, entities] = await Promise.all([
    getSettings(),
    listTenantMembers(),
    getDefaultFunnel(),
    listEntities(),
  ])

  return (
    <>
      <SiteHeader title="Settings" />
      <PageBody>
        <SettingsClient
          settings={settings}
          members={members}
          funnel={funnel}
          entities={entities}
        />
      </PageBody>
    </>
  )
}
