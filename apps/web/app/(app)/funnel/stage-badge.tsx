import { StatusBadge, type StatusTone } from "@/components/status-badge"
import { formatPercent } from "@/lib/format"

/** Stage kind → app-wide semantic tone so stage pills and status pills always
 *  share one shade scale. Kind drives semantics, never the label. */
const KIND_TONE: Record<string, StatusTone> = {
  WON: "success",
  LOST: "danger",
  PARKED: "warning",
}

export function StageBadge({
  name,
  kind,
  code,
  probability,
  className,
}: {
  name: string
  kind: string | null
  code?: string | null
  probability?: string | null
  className?: string
}) {
  return (
    <StatusBadge
      status={kind ?? ""}
      tone={KIND_TONE[kind ?? ""] ?? "info"}
      className={className}
      label={
        <>
          {code ? (
            <span className="font-mono uppercase opacity-70">{code}</span>
          ) : null}
          <span>{name}</span>
          {probability != null ? (
            <span className="opacity-70">· {formatPercent(probability)}</span>
          ) : null}
        </>
      }
    />
  )
}
