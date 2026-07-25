import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading placeholder shaped like the standard record detail page: a title row,
 * then a left highlights card (object tile + fields) + a "Related" card, and a
 * wide tabbed card on the right. Keeps the skeleton in sync with the real
 * 1/3 ↔ 2/3 layout so the page doesn't jump on load.
 */
export function DetailSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left — highlights + related */}
        <div className="grid h-fit gap-4">
          <div className="grid gap-4 rounded-xl border p-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-9 rounded-md" />
              <div className="grid gap-1.5">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid gap-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
          <div className="grid gap-3 rounded-xl border p-4">
            <Skeleton className="h-4 w-16" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — tabbed related lists */}
        <div className="lg:col-span-2">
          <div className="grid min-h-[26rem] gap-4 rounded-xl border p-4">
            <Skeleton className="h-8 w-full max-w-md" />
            <Skeleton className="h-9 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
