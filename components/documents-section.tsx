"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { FileDropzone } from "@/components/file-dropzone"
import { formatDate } from "@/lib/format"
import { showActionError } from "@/lib/show-action-error"
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
  const [busy, setBusy] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<SectionDocument | null>(
    null
  )

  async function onUpload(files: File[]) {
    setBusy(true)
    for (const file of files) {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("attachableType", uploadType)
      fd.append("attachableId", uploadId)
      if (revalidate) fd.append("revalidate", revalidate)
      const res = await uploadEntityAttachment(fd)
      if (res.ok) {
        toast.success(`${file.name} attached`)
      } else {
        showActionError(res)
      }
    }
    router.refresh()
    setBusy(false)
  }

  async function onRename(id: string, next: string) {
    const res = await renameEntityAttachment(id, next, revalidate)
    if (res.ok) {
      toast.success("File renamed")
      router.refresh()
    } else {
      showActionError(res)
    }
  }

  async function onDelete(id: string) {
    const res = await deleteEntityAttachment(id, revalidate)
    if (res.ok) {
      toast.success("File removed")
      router.refresh()
    } else {
      showActionError(res)
    }
    setDeleteTarget(null)
  }

  return (
    <div className="grid gap-3">
      <FileDropzone files={[]} onFiles={onUpload} compact busy={busy} />
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
                  <span aria-hidden>·</span>
                  <span>{formatDate(d.createdAt)}</span>
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
                    onClick={() => setDeleteTarget(d)}
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `“${deleteTarget.fileName}” will be removed. ` : ""}
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && onDelete(deleteTarget.id)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
