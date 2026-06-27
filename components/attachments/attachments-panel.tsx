"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PaperclipIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DocumentViewerButton,
  FileTypeIcon,
} from "@/components/document-viewer"
import { InlineRename } from "@/components/inline-rename"
import {
  uploadEntityAttachment,
  deleteEntityAttachment,
  renameEntityAttachment,
  type AttachmentRow,
} from "@/app/(app)/_shared/attachment-actions"
import { type AttachableType } from "@/app/(app)/_shared/attachment-perms"

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

/** Reusable file list + upload for any CRM entity. */
export function AttachmentsPanel({
  attachableType,
  attachableId,
  items,
  revalidate,
}: {
  attachableType: AttachableType
  attachableId: string
  items: AttachmentRow[]
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
    fd.append("attachableType", attachableType)
    fd.append("attachableId", attachableId)
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

  async function onDelete(id: string) {
    const res = await deleteEntityAttachment(id, revalidate)
    if (res.ok) {
      toast.success("File removed")
      router.refresh()
    } else {
      toast.error(res.error)
    }
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
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="grid gap-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40"
            >
              <FileTypeIcon
                contentType={a.contentType}
                className="size-5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <InlineRename
                  value={a.fileName}
                  onSave={(next) => onRename(a.id, next)}
                  className="truncate font-medium"
                />
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{fmtBytes(a.byteSize)}</span>
                  {fmtDate(a.createdAt) ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{fmtDate(a.createdAt)}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <DocumentViewerButton file={a} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(a.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove"
                  aria-label={`Remove ${a.fileName}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
