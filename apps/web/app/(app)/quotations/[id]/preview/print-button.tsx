"use client"

import { DownloadIcon, PrinterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Triggers the browser's native print dialog (Save as PDF). */
export function PrintButton({ quotationId, quoteNumber }: { quotationId: string; quoteNumber: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" render={<a href={`/api/quotations/${quotationId}/pdf`} download={`${quoteNumber}.pdf`} />}>
        <DownloadIcon className="size-4" />
        Download PDF
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
    </div>
  )
}
