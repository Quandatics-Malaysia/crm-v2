"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Forbidden } from "@/components/forbidden"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Authorization failures bubble up as Error("FORBIDDEN: missing <key>") from
  // assertCan. They are an expected outcome of reaching a page by URL that the
  // role can't access — render a friendly access-denied state (never the raw
  // permission key) instead of the generic crash boundary.
  const isForbidden = error.message?.startsWith("FORBIDDEN") ?? false

  useEffect(() => {
    if (!isForbidden) console.error(error)
  }, [error, isForbidden])

  if (isForbidden) {
    return <Forbidden />
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            We hit an unexpected error while loading this page. You can try
            again, and if it keeps happening, contact your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Button onClick={() => reset()}>
            <RotateCw />
            Try again
          </Button>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
