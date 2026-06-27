"use client"

import * as React from "react"
import {
  EyeIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type ViewableFile = {
  id: string
  fileName: string
  contentType: string
}

function isImage(ct: string) {
  return ct.startsWith("image/")
}
function isPdf(ct: string) {
  return ct.includes("pdf")
}
export function canPreview(ct: string) {
  return isImage(ct) || isPdf(ct)
}

/** A small, content-type aware file glyph reused across the document lists. */
export function FileTypeIcon({
  contentType,
  className,
}: {
  contentType: string
  className?: string
}) {
  if (isImage(contentType)) return <ImageIcon className={className} />
  if (isPdf(contentType)) return <FileTextIcon className={className} />
  return <FileIcon className={className} />
}

/** A "view" button that opens the file inline (PDF/image) in a large viewer
 *  dialog, with a toolbar in the header. Non-previewable types download. */
export function DocumentViewerButton({ file }: { file: ViewableFile }) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const src = `/api/files/${file.id}`
  const previewable = canPreview(file.contentType)

  function onOpenChange(next: boolean) {
    if (next) setLoading(true)
    setOpen(next)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={previewable ? "View" : "Download"}
        aria-label={
          previewable ? `View ${file.fileName}` : `Download ${file.fileName}`
        }
        onClick={() =>
          previewable ? onOpenChange(true) : window.open(`${src}?dl`)
        }
        className="text-muted-foreground hover:text-foreground"
      >
        {previewable ? (
          <EyeIcon className="size-4" />
        ) : (
          <DownloadIcon className="size-4" />
        )}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center gap-2 space-y-0 border-b px-4 py-2.5 pr-12">
            <FileTypeIcon
              contentType={file.contentType}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <DialogTitle
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={file.fileName}
            >
              {file.fileName}
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                render={
                  <a href={src} target="_blank" rel="noopener noreferrer" />
                }
              >
                <ExternalLinkIcon className="size-4" />
                <span className="hidden sm:inline">Open in new tab</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`${src}?dl`)}
              >
                <DownloadIcon className="size-4" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </div>
          </DialogHeader>
          <div className="relative min-h-0 flex-1 bg-muted/40">
            {loading && canPreview(file.contentType) ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading preview…
              </div>
            ) : null}
            {isImage(file.contentType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.fileName}
                onLoad={() => setLoading(false)}
                className="mx-auto h-full w-full object-contain"
              />
            ) : isPdf(file.contentType) ? (
              <iframe
                src={`${src}#view=FitH`}
                title={file.fileName}
                onLoad={() => setLoading(false)}
                className="h-full w-full border-0"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <FileTypeIcon
                  contentType={file.contentType}
                  className="size-10 opacity-60"
                />
                <p>Preview isn’t available for this file type.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`${src}?dl`)}
                >
                  <DownloadIcon className="size-4" />
                  Download file
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
