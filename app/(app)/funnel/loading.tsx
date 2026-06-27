import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Funnel route skeleton. The Board tab is the default, so this mirrors the
 * kanban layout (tabs + a row of stage columns with card placeholders) rather
 * than reflowing through the generic three-line fallback before the board
 * paints.
 */
export default function Loading() {
  return (
    <>
      <SiteHeader title="Funnel" />
      <PageBody>
        {/* Tabs + "+ New" toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>

        {/* Board: stage columns */}
        <div className="flex gap-4 overflow-x-auto pb-2 pt-2">
          {Array.from({ length: 5 }).map((_, col) => (
            <div
              key={col}
              className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-2 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-4 w-6" />
              </div>
              <Skeleton className="h-3 w-16" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 - (col % 2) }).map((_, card) => (
                  <div
                    key={card}
                    className="grid gap-2 rounded-xl border bg-card p-3"
                  >
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <div className="mt-1 flex items-center justify-between">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  )
}
