import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listAccountOptions } from "@/lib/lookups"
import { requireEntitledRoute } from "@/lib/module-guard"
import { listInboundIntercompanyDeals } from "./actions"
import { IntercompanyTable } from "./intercompany-table"

export default async function IntercompanyPage() {
  await requireEntitledRoute("finance")
  const [rows, accountOptions] = await Promise.all([
    listInboundIntercompanyDeals(),
    listAccountOptions(),
  ])

  return (
    <>
      <SiteHeader title="Intercompany" />
      <PageBody>
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Inbound intercompany deals
          </h2>
          <p className="text-sm text-muted-foreground">
            Deals other group entities own and have assigned to this entity as
            the handling partner. Read-only — the origin entity owns the
            record; your share is the remainder after its recognized cut.
          </p>
        </div>
        <IntercompanyTable data={rows} accountOptions={accountOptions} />
      </PageBody>
    </>
  )
}
