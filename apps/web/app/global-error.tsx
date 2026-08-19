"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { reportIncident } from "@/app/(app)/_shared/operator-alert-actions"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Report the crash to the operator log so the vendor is notified.
  useEffect(() => {
    reportIncident({
      severity: "critical",
      summary: `Global crash: ${error.message}`,
      detail: error.stack ?? error.message,
      source: "global_error_boundary",
      errorMessage: error.message,
      errorDigest: error.digest,
    }).catch(() => {})
  }, [error])

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    // global-error replaces the root layout, so it must render html/body itself.
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-6" />
          </div>
          <div className="grid gap-1">
            <h1 className="text-lg font-semibold tracking-tight">
              Something went wrong
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              The application hit an unexpected error. Please try again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => reset()}>
              <RotateCw />
              Try again
            </Button>
            {error.digest ? (
              <p className="text-xs text-muted-foreground">
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  )
}
