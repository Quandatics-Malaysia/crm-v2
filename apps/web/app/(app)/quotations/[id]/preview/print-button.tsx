"use client"

import { useState } from "react"
import { DownloadIcon, PrinterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Triggers the browser's native print dialog (Save as PDF). */
export function PrintButton({ quotationId, quoteNumber }: { quotationId: string; quoteNumber: string }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function downloadPdf() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const response = await fetch(`/api/quotations/${quotationId}/pdf`, {
        credentials: "same-origin",
        cache: "no-store",
      })
      const contentType = response.headers.get("content-type") ?? ""
      const bytes = new Uint8Array(await response.arrayBuffer())
      const isPdf =
        response.ok &&
        contentType.toLowerCase().includes("application/pdf") &&
        new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      if (!isPdf) throw new Error("The quotation PDF could not be generated.")

      const blob = new Blob([bytes], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${quoteNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The quotation PDF could not be generated.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={downloadPdf} disabled={downloading}>
        <DownloadIcon className="size-4" />
        {downloading ? "Preparing PDF…" : "Download PDF"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const previousTitle = document.title
          document.title = quoteNumber
          window.print()
          window.setTimeout(() => { document.title = previousTitle }, 1000)
        }}
      >
        <PrinterIcon className="size-4" />
        Print
      </Button>
      {downloadError ? (
        <span role="alert" className="text-xs text-destructive">
          {downloadError}
        </span>
      ) : null}
    </div>
  )
}
