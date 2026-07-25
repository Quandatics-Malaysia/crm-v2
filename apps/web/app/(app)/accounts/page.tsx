import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listIndustries, listCountries, getFormPresets } from "@/lib/lookups"
import { listAccounts } from "./actions"
import { AccountsTable } from "./accounts-table"

export default async function AccountsPage() {
  const [accounts, industries, countries, presets] = await Promise.all([
    listAccounts(),
    listIndustries(),
    listCountries(),
    getFormPresets(),
  ])
  const parentOptions = accounts.map((a) => ({ id: a.id, name: a.name }))

  return (
    <>
      <SiteHeader title="Accounts" />
      <PageBody>
        <AccountsTable
          data={accounts}
          parentOptions={parentOptions}
          industries={industries}
          countries={countries}
          presets={presets}
        />
      </PageBody>
    </>
  )
}
