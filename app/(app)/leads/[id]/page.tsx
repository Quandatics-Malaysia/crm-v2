import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { buildFunnelSteps, buildLeadSteps } from "@/components/stage-progress"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import {
  listAccountOptions,
  listFunnelsWithStages,
  listCountries,
} from "@/lib/lookups"
import { formatDate } from "@/lib/format"
import { getLead } from "../actions"
import { LeadEditButton } from "./lead-edit-button"
import { LeadDetailActions } from "./lead-detail-actions"
import { LeadDetailBody } from "./lead-detail-body"

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [data, pipelines, accountOptions, countries] = await Promise.all([
    getLead(id),
    listFunnelsWithStages(),
    listAccountOptions(),
    listCountries(),
  ])
  if (!data) notFound()

  const { lead, stageName, funnelName, accountName, personName } = data
  const [activity, files] = await Promise.all([
    listActivities("lead", id),
    listEntityAttachments("lead", id),
  ])

  // Salesforce-named field sections (SPEC §2). Company Information groups the
  // company/contact-channel fields; Lead Information groups the lead's own
  // status/source/funnel data. Only fields already fetched are included.
  const companyInformation: { label: string; value: React.ReactNode }[] = [
    { label: "Company", value: lead.companyName ?? "—" },
    { label: "Phone", value: lead.phone ?? "—" },
  ]

  const leadInformation: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: STATUS_LABEL[lead.status] ?? lead.status },
    {
      label: "Email",
      value: lead.email ? (
        <a
          href={`mailto:${lead.email}`}
          className="link"
        >
          {lead.email}
        </a>
      ) : (
        "—"
      ),
    },
    { label: "Source", value: lead.source ?? "—" },
    {
      label: "Funnel",
      value: funnelName ? (
        lead.convertedOpportunityId ? (
          <Link
            href={`/opportunities/${lead.convertedOpportunityId}`}
            className="link"
          >
            {funnelName}
          </Link>
        ) : (
          funnelName
        )
      ) : (
        "—"
      ),
    },
    { label: "Created", value: formatDate(lead.createdAt) },
  ]

  // Remarks section: only when a disqualify reason is actually present.
  const remarks: { label: string; value: React.ReactNode }[] =
    lead.status === "disqualified" && lead.disqualifyReason
      ? [{ label: "Disqualify reason", value: lead.disqualifyReason }]
      : []

  const sections: { title: string; fields: { label: string; value: React.ReactNode }[] }[] = [
    { title: "Company Information", fields: companyInformation },
    { title: "Lead Information", fields: leadInformation },
    ...(remarks.length ? [{ title: "Remarks", fields: remarks }] : []),
  ]

  const isConverted =
    !!lead.convertedAccountId ||
    !!lead.convertedPersonId ||
    !!lead.convertedOpportunityId

  // When the lead has its own pipeline stage, render a funnel progress below
  // the lead-status progress. Stages come from the already-loaded pipelines
  // lookup (id/name/kind/sortOrder, ordered) — no extra fetch needed.
  const leadFunnelStages =
    lead.pipelineId && lead.currentStageId
      ? pipelines.find((f) => f.id === lead.pipelineId)?.stages ?? null
      : null
  const funnelProgress =
    leadFunnelStages && lead.currentStageId
      ? buildFunnelSteps(leadFunnelStages, lead.currentStageId)
      : null
  const leadProgress = buildLeadSteps(lead.status)

  return (
    <>
      <SiteHeader
        title={lead.name}
        breadcrumbs={[
          { label: "Leads", href: "/leads" },
          { label: lead.name },
        ]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {lead.name}
            </h2>
            {lead.companyName ? (
              <p className="text-sm text-muted-foreground">
                {lead.companyName}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stageName ? (
              <Badge variant="outline" className="font-normal">
                {stageName}
              </Badge>
            ) : null}
            {!isConverted ? (
              <LeadDetailActions
                lead={lead}
                accountOptions={accountOptions}
                countries={countries}
              />
            ) : null}
            <LeadEditButton lead={lead} pipelines={pipelines} />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/leads" />}
            >
              Back to leads
            </Button>
          </div>
        </div>

        <LeadDetailBody
          leadId={id}
          status={lead.status}
          sections={sections}
          leadSteps={leadProgress.steps}
          leadNote={leadProgress.note}
          funnelSteps={funnelProgress?.steps ?? null}
          funnelNote={funnelProgress?.note ?? null}
          converted={
            isConverted
              ? {
                  accountId: lead.convertedAccountId,
                  accountName,
                  personId: lead.convertedPersonId,
                  personName,
                  funnelId: lead.convertedOpportunityId,
                  funnelName,
                }
              : null
          }
          activity={activity}
          files={files.map((f) => ({ ...f, source: "Lead", ownedHere: true }))}
        />
      </PageBody>
    </>
  )
}
