import type { ChangeEntry } from "@/server/services/changes/types"

export function ChangeList({ changes }: { changes: ChangeEntry[] }) {
  if (!changes?.length) return null
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {changes.map((c) => (
        <div key={c.field} className="contents">
          <dt className="text-muted-foreground">{c.label}</dt>
          <dd>
            <span className="line-through opacity-60">{c.from}</span>
            <span className="mx-1">→</span>
            <span className="font-medium">{c.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
