"use client"

import { PrinterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Triggers the browser's native print dialog (Save as PDF). */
export function PrintButton({ quoteNumber }: { quoteNumber: string }) {
  return (
    <Button
      size="sm"
      onClick={() => {
        const previousTitle = document.title
        document.title = quoteNumber
        window.print()
        window.setTimeout(() => { document.title = previousTitle }, 1000)
      }}
    >
      <PrinterIcon className="size-4" />
      Print / Save PDF
    </Button>
  )
}
