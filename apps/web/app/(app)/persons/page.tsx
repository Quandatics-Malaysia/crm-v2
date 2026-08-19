import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listAccountOptions, getFormPresets } from "@/lib/lookups"
import { listPersons } from "./actions"
import { PersonsTable } from "./persons-table"

export default async function PersonsPage() {
  const [persons, accounts, presets] = await Promise.all([
    listPersons(),
    listAccountOptions(),
    getFormPresets(),
  ])

  return (
    <>
      <SiteHeader title="Contacts" />
      <PageBody>
        <PersonsTable
          data={persons}
          accounts={accounts}
          phonePrefix={presets.phonePrefix}
          defaultCountry={presets.defaultCountry || "MY"}
        />
      </PageBody>
    </>
  )
}
