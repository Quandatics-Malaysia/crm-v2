import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listTaxSettings } from "./actions"
import { TaxSettingsClient } from "./tax-settings-client"

export default async function TaxSettingsPage() {
  const rows = await listTaxSettings()
  return (
    <>
      <SiteHeader title="Tax settings" />
      <PageBody>
        <PageHeader
          title="Tax settings"
          description="Tax rates applied to quotations across your organization."
        />
        <TaxSettingsClient data={rows} />
      </PageBody>
    </>
  )
}
