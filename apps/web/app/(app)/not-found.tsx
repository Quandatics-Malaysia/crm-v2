import Link from "next/link"
import { FileQuestion } from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function NotFound() {
  return (
    <>
      <SiteHeader title="Not found" />
      <PageBody>
        <div className="flex flex-1 flex-col items-center justify-center">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileQuestion className="size-5" />
              </div>
              <CardTitle>Page not found</CardTitle>
              <CardDescription>
                The page or record you&apos;re looking for doesn&apos;t exist or
                you no longer have access to it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button nativeButton={false} render={<Link href="/dashboard" />}>
                Back to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
