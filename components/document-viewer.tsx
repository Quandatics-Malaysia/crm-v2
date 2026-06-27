"use client"

import * as React from "react"
import { EyeIcon, DownloadIcon } from "lucide-react"

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

/** A "view" button that opens the file inline (PDF/image) in a large viewer
 *  dialog, with a download in the header. Non-previewable types download. */
export function DocumentViewerButton({ file }: { file: ViewableFile }) {
  const [open, setOpen] = React.useState(false)
  const src = `/api/files/${file.id}`
  const previewable = canPreview(file.contentType)

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={previewable ? "View" : "Download"}
        aria-label={
          previewable
            ? `View ${file.fileName}`
            : `Download ${file.fileName}`
        }
        onClick={() => (previewable ? setOpen(true) : window.open(`${src}?dl`))}
        className="text-muted-foreground hover:text-foreground"
      >
        <EyeIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88vh] w-[94vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b px-4 py-2.5 pr-12">
            <DialogTitle
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={file.fileName}
            >
              {file.fileName}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${src}?dl`)}
            >
              <DownloadIcon className="size-4" />
              Download
            </Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-muted/40">
            {isImage(file.contentType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.fileName}
                className="mx-auto h-full w-full object-contain"
              />
            ) : isPdf(file.contentType) ? (
              <iframe
                src={`${src}#view=FitH`}
                title={file.fileName}
                className="h-full w-full border-0"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Preview not available for this file type.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
