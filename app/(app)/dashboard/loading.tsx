import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Dashboard" />
      <PageBody>
        <div className="grid gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="size-8 rounded-md" />
              </div>
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-48 w-full" />
            </div>
          ))}
        </div>
      </PageBody>
    </>
  )
}
