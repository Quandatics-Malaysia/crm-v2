import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { TableSkeleton } from "@/components/table-skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Audit log" />
      <PageBody>
        <Skeleton className="h-4 w-80" />
        <TableSkeleton rows={8} />
      </PageBody>
    </>
  )
}
