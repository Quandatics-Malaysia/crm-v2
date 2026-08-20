import { PageBody } from "@/components/page-header"
import { DetailSkeleton } from "@/components/detail-skeleton"

export default function Loading() {
  return (
    <>
      <PageBody>
        <DetailSkeleton />
      </PageBody>
    </>
  )
}
