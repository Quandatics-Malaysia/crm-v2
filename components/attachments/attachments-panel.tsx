"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PaperclipIcon, PencilIcon, Trash2Icon, FileIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DocumentViewerButton } from "@/components/document-viewer"
import {
  uploadEntityAttachment,
  deleteEntityAttachment,
  renameEntityAttachment,
  type AttachableType,
  type AttachmentRow,
} from "@/app/(app)/_shared/attachment-actions"

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
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
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("attachableType", attachableType)
      fd.append("attachableId", attachableId)
      if (revalidate) fd.append("revalidate", revalidate)
      await uploadEntityAttachment(fd)
      toast.success("File attached")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteEntityAttachment(id, revalidate)
      toast.success("File removed")
      router.refresh()
    } catch {
      toast.error("Delete failed")
    }
  }

  async function onRename(a: AttachmentRow) {
    const next = window.prompt("Rename file", a.fileName)?.trim()
    if (!next || next === a.fileName) return
    try {
      await renameEntityAttachment(a.id, next, revalidate)
      toast.success("File renamed")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed")
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
        <ul className="grid gap-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <FileIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{a.fileName}</span>
              <span className="text-xs text-muted-foreground">
                {fmtBytes(a.byteSize)}
              </span>
              <DocumentViewerButton file={a} />
              <button
                type="button"
                onClick={() => onRename(a)}
                className="text-muted-foreground hover:text-foreground"
                title="Rename"
              >
                <PencilIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(a.id)}
                className="text-muted-foreground hover:text-destructive"
                title="Remove"
              >
                <Trash2Icon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
