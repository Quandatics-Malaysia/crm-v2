import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Project" />
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="grid gap-3 rounded-lg border p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="grid gap-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
      </PageBody>
    </>
  )
}
