import { notFound } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { getEntitledModuleMap } from "@/lib/modules.server"
import {
  listProjectNatures,
  listMembers,
  listFunnelsWithStages,
  listCustomFunnelFields,
  listEntities,
  listCurrencies,
} from "@/lib/lookups"
import { getOpportunity } from "../actions"
import { listPersonsWithAccount } from "@/app/(app)/funnel/actions"
import { OpportunityForm } from "@/app/(app)/funnel/opportunity-form"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import { OpportunityDetailBody } from "./opportunity-detail-body"

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab } = await searchParams
  const [
    ctx,
    detail,
    attachments,
    persons,
    projectNatures,
    members,
    pipelines,
    customFunnelFields,
    entities,
    currencies,
    modules,
  ] = await Promise.all([
    requireContext(),
    getOpportunity(id),
    listEntityAttachments("opportunity_container", id),
    listPersonsWithAccount(),
    listProjectNatures(),
    listMembers(),
    listFunnelsWithStages(),
    listCustomFunnelFields(),
    listEntities(),
    listCurrencies(),
    getEntitledModuleMap(),
  ])
  if (!detail) notFound()
  const o = detail.opportunity
  const canUpdate = ctx.can(PERMISSIONS.OPPORTUNITY_UPDATE)
  const canCreateFunnel = ctx.can(PERMISSIONS.OPPORTUNITY_CREATE)
  const newFunnelButton = canCreateFunnel ? (
    <OpportunityForm
      mode="create"
      opportunityId={o.id}
      accounts={[{ id: detail.accountId, name: detail.accountName, currency: detail.accountCurrency }]}
      persons={persons}
      members={members}
      pipelines={pipelines}
      customFieldDefs={customFunnelFields}
      entityOptions={entities}
      financeEnabled={modules.finance}
      currencies={currencies}
      defaultOwnerMemberId={ctx.memberId}
    />
  ) : undefined
  // The container has no rollup sources (unlike the funnel's Documents tab,
  // which also pulls in quotation/approval files) — every attachment here is
  // owned directly by the opportunity.
  const documents = attachments.map((a) => ({
    ...a,
    source: "Opportunity",
    ownedHere: true,
  }))

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
        <OpportunityDetailBody
          detail={detail}
          documents={documents}
          projectNatures={projectNatures}
          newFunnelButton={newFunnelButton}
          persons={persons}
          canEdit={canUpdate}
          initialTab={tab}
        />
      </PageBody>
    </>
  )
}
