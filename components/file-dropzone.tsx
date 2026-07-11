"use client"

import * as React from "react"
import { useDropzone, type Accept } from "react-dropzone"
import { UploadCloudIcon, XIcon, FileIcon, Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Convert an `<input accept>`-style string into react-dropzone's Accept map. */
function toAccept(accept?: string): Accept | undefined {
  if (!accept) return undefined
  const out: Accept = {}
  for (const part of accept.split(",")) {
    const s = part.trim()
    if (!s) continue
    if (s.startsWith(".")) {
      // ponytail: bare extensions grouped under a catch-all key; attr-accept
      // matches on the extension list, the MIME key is just a bucket.
      out["application/octet-stream"] = [
        ...(out["application/octet-stream"] ?? []),
        s,
      ]
    } else {
      out[s] = out[s] ?? []
    }
  }
  return out
}

/**
 * Drag-and-drop (or click-to-browse) file picker built on react-dropzone.
 * Supports multiple files and shows the selected list with per-file remove.
 * Used everywhere a document is uploaded. For immediate-upload callers, pass
 * files={[]} and upload inside onFiles; pass busy to show progress.
 */
export function FileDropzone({
  files,
  onFiles,
  multiple = true,
  accept,
  hint,
  busy = false,
  compact = false,
}: {
  files: File[]
  onFiles: (files: File[]) => void
  multiple?: boolean
  accept?: string
  hint?: string
  busy?: boolean
  /** Tighter padding for dialogs / inline forms. */
  compact?: boolean
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple,
    accept: toAccept(accept),
    disabled: busy,
    onDrop: (accepted) => {
      if (accepted.length === 0) return
      onFiles(multiple ? [...files, ...accepted] : accepted.slice(0, 1))
    },
  })

  return (
    <div className="grid w-full min-w-0 gap-2">
      <div
        {...getRootProps()}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 text-center transition-colors",
          compact ? "py-3" : "py-6",
          busy && "cursor-default opacity-60",
          isDragActive
            ? "border-primary bg-muted/50 ring-2 ring-primary/30"
            : "border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/40"
        )}
      >
        <input {...getInputProps()} />
        {busy ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloudIcon className="size-6 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {busy
            ? "Uploading…"
            : `Drop ${multiple ? "documents" : "a document"} here`}
        </span>
        {!busy ? (
          <span className="text-xs text-muted-foreground">
            or click to browse{hint ? ` · ${hint}` : ""}
          </span>
        ) : null}
      </div>
      {files.length > 0 ? (
        <ul className="grid gap-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, idx) => idx !== i))}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove"
                aria-label={`Remove ${f.name}`}
              >
                <XIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
