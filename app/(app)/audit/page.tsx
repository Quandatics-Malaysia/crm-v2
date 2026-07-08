import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireModule } from "@/lib/module-guard"
import { listAudit } from "./actions"
import { AuditTable } from "./audit-table"

export default async function AuditPage() {
  requireModule("audit")
  const rows = await listAudit()

  return (
    <>
      <SiteHeader title="Audit log" />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          A read-only, append-only record of changes across your workspace.
        </p>
        <AuditTable data={rows} />
      </PageBody>
    </>
  )
}
