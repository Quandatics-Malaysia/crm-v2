import { notFound } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { getOpportunity } from "../actions"
import { OpportunityDetailBody } from "./opportunity-detail-body"

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getOpportunity(id)
  if (!detail) notFound()
  const o = detail.opportunity

  return (
    <>
      <SiteHeader
        title={o.name}
        breadcrumbs={[
          { label: "Opportunities", href: "/opportunities" },
          { label: o.name },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{o.name}</h2>
          <Badge variant="outline" className="font-mono font-normal">
            {o.code}
          </Badge>
        </div>
        <OpportunityDetailBody detail={detail} />
      </PageBody>
    </>
  )
}
