import { Skeleton } from "@/components/ui/skeleton"

/**
 * List skeleton mirroring {@link DataTable}'s layout (search + filter toolbar,
 * a bordered row area, and a pagination footer). Use it in per-route list
 * `loading.tsx` files so the loading state matches the resolved table.
 */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {/* toolbar: search + filters on the left, column controls on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-8 w-24" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-4 border-b px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>

      {/* pagination footer */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </div>
  )
}
