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

/** A "view" button that opens the file inline (PDF/image) in a dialog, with a
 *  download fallback. Non-previewable types download directly. */
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
        onClick={() => (previewable ? setOpen(true) : window.open(`${src}?dl`))}
        className="text-muted-foreground hover:text-foreground"
      >
        <EyeIcon className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{file.fileName}</DialogTitle>
          </DialogHeader>
          <div className="h-[70vh] w-full overflow-auto rounded-md border bg-muted/30">
            {isImage(file.contentType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={file.fileName}
                className="mx-auto max-h-full object-contain"
              />
            ) : isPdf(file.contentType) ? (
              <iframe src={src} title={file.fileName} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Preview not available for this file type.
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${src}?dl`)}
            >
              <DownloadIcon className="size-4" />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
