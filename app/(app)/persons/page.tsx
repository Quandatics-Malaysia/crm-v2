import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listAccountOptions } from "@/lib/lookups"
import { listPersons } from "./actions"
import { PersonsTable } from "./persons-table"

export default async function PersonsPage() {
  const [persons, accounts] = await Promise.all([
    listPersons(),
    listAccountOptions(),
  ])

  return (
    <>
      <SiteHeader title="Contacts" />
      <PageBody>
        <PersonsTable data={persons} accounts={accounts} />
      </PageBody>
    </>
  )
}
