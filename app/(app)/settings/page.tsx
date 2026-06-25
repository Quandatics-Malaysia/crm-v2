import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import {
  getSettings,
  listTenantMembers,
  getDefaultFunnel,
} from "./actions"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  const [settings, members, funnel] = await Promise.all([
    getSettings(),
    listTenantMembers(),
    getDefaultFunnel(),
  ])

  return (
    <>
      <SiteHeader title="Settings" />
      <PageBody>
        <PageHeader
          title="Settings"
          description="Configure entity defaults, numbering, industries, pipeline stages, and your team."
        />
        <SettingsClient settings={settings} members={members} funnel={funnel} />
      </PageBody>
    </>
  )
}
