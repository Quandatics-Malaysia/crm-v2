"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PaperclipIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DocumentViewerButton,
  FileTypeIcon,
} from "@/components/document-viewer"
import { InlineRename } from "@/components/inline-rename"
import {
  uploadEntityAttachment,
  deleteEntityAttachment,
  renameEntityAttachment,
} from "@/app/(app)/_shared/attachment-actions"
import { type AttachableType } from "@/app/(app)/_shared/attachment-perms"

export type SectionDocument = {
  id: string
  fileName: string
  contentType: string
  byteSize: number
  createdAt: string
  source: string
  ownedHere: boolean
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * One unified documents block: shows every file related to the record (with a
 * source label), lets you attach new files to THIS record, and view/rename/
 * delete the files owned here. Replaces the old separate attachments + rolled-up
 * documents sections.
 */
export function DocumentsSection({
  uploadType,
  uploadId,
  documents,
  revalidate,
}: {
  uploadType: AttachableType
  uploadId: string
  documents: SectionDocument[]
  revalidate?: string
}) {
  const router = useRouter()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    const fd = new FormData()
    fd.append("file", file)
    fd.append("attachableType", uploadType)
    fd.append("attachableId", uploadId)
    if (revalidate) fd.append("revalidate", revalidate)
    const res = await uploadEntityAttachment(fd)
    if (res.ok) {
      toast.success("File attached")
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function onRename(id: string, next: string) {
    const res = await renameEntityAttachment(id, next, revalidate)
    if (res.ok) {
      toast.success("File renamed")
      router.refresh()
    } else {
      toast.error(res.error)
    }
  }

  async function onDelete(id: string) {
    const res = await deleteEntityAttachment(id, revalidate)
    if (res.ok) {
      toast.success("File removed")
      router.refresh()
    } else {
      toast.error(res.error)
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <input ref={fileRef} type="file" className="hidden" onChange={onUpload} />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <PaperclipIcon className="size-4" />
          {busy ? "Uploading…" : "Attach file"}
        </Button>
      </div>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="grid gap-1.5">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40"
            >
              <FileTypeIcon
                contentType={d.contentType}
                className="size-5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                {d.ownedHere ? (
                  <InlineRename
                    value={d.fileName}
                    onSave={(next) => onRename(d.id, next)}
                    className="truncate font-medium"
                  />
                ) : (
                  <span className="truncate font-medium">{d.fileName}</span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{fmtBytes(d.byteSize)}</span>
                  {fmtDate(d.createdAt) ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{fmtDate(d.createdAt)}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {d.source}
              </Badge>
              <div className="flex shrink-0 items-center gap-0.5">
                <DocumentViewerButton file={d} />
                {d.ownedHere ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(d.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Remove"
                    aria-label={`Remove ${d.fileName}`}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
