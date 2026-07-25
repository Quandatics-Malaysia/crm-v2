"use client"

import { PrinterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Triggers the browser's native print dialog (Save as PDF). */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <PrinterIcon className="size-4" />
      Print / Save as PDF
    </Button>
  )
}
