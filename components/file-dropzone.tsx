"use client"

import * as React from "react"
import { UploadCloudIcon, XIcon, FileIcon, Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Drag-and-drop (or click-to-browse) file picker. Supports multiple files and
 * shows the selected list with per-file remove. Used everywhere a document is
 * uploaded. For immediate-upload callers, pass files={[]} and upload inside
 * onFiles; pass busy to show progress.
 */
export function FileDropzone({
  files,
  onFiles,
  multiple = true,
  accept,
  hint,
  busy = false,
}: {
  files: File[]
  onFiles: (files: File[]) => void
  multiple?: boolean
  accept?: string
  hint?: string
  busy?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const incoming = Array.from(list)
    onFiles(multiple ? [...files, ...incoming] : incoming.slice(0, 1))
  }

  return (
    <div className="grid w-full min-w-0 gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!busy) addFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors disabled:opacity-60",
          dragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/40"
        )}
      >
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
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          if (inputRef.current) inputRef.current.value = ""
        }}
      />
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
