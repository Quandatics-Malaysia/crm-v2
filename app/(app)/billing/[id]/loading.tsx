import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { DetailSkeleton } from "@/components/detail-skeleton"

export default function Loading() {
  return (
    <>
      <SiteHeader title="Billing Document" />
      <PageBody>
        <DetailSkeleton />
      </PageBody>
    </>
  )
}
