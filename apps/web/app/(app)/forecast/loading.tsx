import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Forecast" />
      <PageBody>
        <div className="grid gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
        <div className="grid gap-3 rounded-lg border p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageBody>
    </>
  )
}
