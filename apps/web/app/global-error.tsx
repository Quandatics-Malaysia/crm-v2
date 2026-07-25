"use client"

import { useEffect } from "react"

import "./globals.css"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    // global-error replaces the root layout, so it must render html/body itself.
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="grid gap-1">
            <h1 className="text-lg font-semibold tracking-tight">
              Something went wrong
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              The application hit an unexpected error. Please try again.
            </p>
          </div>
          <button
            onClick={() => reset()}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
          >
            Try again
          </button>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
