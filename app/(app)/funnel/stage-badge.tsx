import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatPercent } from "@/lib/format"

/** Tailwind class set per stage kind. Kind drives semantics, never the label. */
function kindClasses(kind: string): string {
  switch (kind) {
    case "WON":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
    case "LOST":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
    case "PARKED":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
    default:
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
  }
}

export function StageBadge({
  name,
  kind,
  probability,
  className,
}: {
  name: string
  kind: string
  probability?: string | null
  className?: string
}) {
  return (
    <Badge className={cn(kindClasses(kind), className)}>
      <span>{name}</span>
      {probability != null ? (
        <span className="opacity-70">· {formatPercent(probability)}</span>
      ) : null}
    </Badge>
  )
}
