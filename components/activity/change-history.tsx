import type { ActivityRow } from "@/app/(app)/_shared/activity-actions"
import { ChangeList } from "./change-list"
import { formatDate } from "@/lib/format"

export function ChangeHistory({ items }: { items: ActivityRow[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
  return (
    <ol className="space-y-4">
      {items.map((it) => (
        <li key={it.id} className="border-l-2 pl-3">
          <div className="text-sm">
            <span className="font-medium">{it.memberName ?? "Someone"}</span>{" "}
            <span className="text-muted-foreground">· {formatDate(it.occurredAt)}</span>
          </div>
          <ChangeList changes={it.changes ?? []} />
        </li>
      ))}
    </ol>
  )
}
