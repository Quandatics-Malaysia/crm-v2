import Link from "next/link"
import { ShieldX } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Friendly access-denied state for a page a user reaches without permission
 * (e.g. by URL, when the nav already hides the entry). Deliberately never
 * surfaces the raw permission key — just an explanation and a way back.
 *
 * Presentational only (no hooks / client APIs), so it renders in both the
 * server tree (a page) and the client tree (the error boundary).
 */
export function Forbidden({
  title = "You don't have access to this page",
  description = "Your role doesn't include permission to view this page. If you think this is a mistake, contact your administrator.",
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldX className="size-5" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
