import { DownloadIcon, FileIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { EntityDocument } from "@/app/(app)/_shared/attachment-actions"

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Read-only rolled-up document list for an entity detail page. Each row shows
 * the source (where the file lives) as a Badge plus a download link.
 */
export function DocumentsList({ items }: { items: EntityDocument[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents yet.</p>
  }
  return (
    <ul className="grid gap-1">
      {items.map((d) => (
        <li
          key={d.id}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{d.fileName}</span>
          <Badge variant="outline" className="font-normal">
            {d.source}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {fmtBytes(d.byteSize)}
          </span>
          <a
            href={`/api/files/${d.id}`}
            className="text-muted-foreground hover:text-foreground"
            title="Download"
          >
            <DownloadIcon className="size-4" />
          </a>
        </li>
      ))}
    </ul>
  )
}
