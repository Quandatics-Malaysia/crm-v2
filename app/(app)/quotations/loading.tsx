import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Quotations" />
      <PageBody>
        <TableSkeleton rows={8} />
      </PageBody>
    </>
  )
}
