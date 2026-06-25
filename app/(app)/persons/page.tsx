import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
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
        <PageHeader
          title="Contacts"
          description="Every person across your accounts."
        />
        <PersonsTable data={persons} accounts={accounts} />
      </PageBody>
    </>
  )
}
