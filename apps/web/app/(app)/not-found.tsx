import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { NotFoundView } from "@/components/not-found-view"

export default function NotFound() {
  return (
    <>
      <SiteHeader title="Not found" />
      <PageBody>
        <NotFoundView />
      </PageBody>
    </>
  )
}
