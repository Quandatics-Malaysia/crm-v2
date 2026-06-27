import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/** Neutral page-level fallback. Route segments that have a distinct shape
 *  (dashboard / forecast / detail / list routes) provide their own loading.tsx
 *  so the fallback never reads as a glitch reflowing into the real layout. */
export default function Loading() {
  return (
    <>
      <SiteHeader title="Loading" />
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </PageBody>
    </>
  )
}
