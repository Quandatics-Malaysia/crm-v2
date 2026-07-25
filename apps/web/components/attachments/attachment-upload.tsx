"use client"

import * as React from "react"
import { Paperclip, Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FileDropzone } from "@/components/file-dropzone"
import { showActionError } from "@/lib/show-action-error"
import {
  uploadEntityAttachment,
  type AttachmentRow,
} from "@/app/(app)/_shared/attachment-actions"
import { type AttachableType } from "@/app/(app)/_shared/attachment-perms"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentUpload({
  attachableType,
  attachableId,
  onUploaded,
}: {
  attachableType: AttachableType
  attachableId: string
  onUploaded?: () => void
}) {
  const [file, setFile] = React.useState<File | null>(null)
  const [pending, startTransition] = React.useTransition()

  function handleUpload() {
    if (!file) {
      toast.error("Choose a file first")
      return
    }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("attachableType", attachableType)
    fd.set("attachableId", attachableId)
    startTransition(async () => {
      const res = await uploadEntityAttachment(fd)
      if (res.ok) {
        toast.success("File uploaded")
        setFile(null)
        onUploaded?.()
      } else {
        showActionError(res)
      }
    })
  }

  return (
    <div className="grid gap-2">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={(fs) => setFile(fs[0] ?? null)}
        multiple={false}
        compact
        busy={pending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="justify-self-start"
        onClick={handleUpload}
        disabled={pending || !file}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Paperclip className="size-4" />
        )}
        Upload
      </Button>
    </div>
  )
}

export function AttachmentList({ items }: { items: AttachmentRow[] }) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No attachments.</p>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{a.fileName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(a.byteSize)}
            </span>
          </span>
          <a
            href={`/api/files/${a.id}`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium link"
            download
          >
            <Download className="size-3.5" />
            Download
          </a>
        </li>
      ))}
    </ul>
  )
}
