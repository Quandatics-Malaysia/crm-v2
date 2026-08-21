import Link from "next/link"
import { FileQuestion } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function NotFoundView() {
  return (
    <div className="flex min-h-[min(32rem,70svh)] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileQuestion className="size-5" />
          </div>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            The page or record you&apos;re looking for doesn&apos;t exist or you no
            longer have access to it.
          </CardDescription>
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
