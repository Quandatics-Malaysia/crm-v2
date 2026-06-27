import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import {
  StageProgress,
  buildFunnelSteps,
  buildLeadSteps,
} from "@/components/stage-progress"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listEntityAttachments } from "@/app/(app)/_shared/attachment-actions"
import { listAccountOptions, listFunnelsWithStages } from "@/lib/lookups"
import { formatDate } from "@/lib/format"
import { getLead } from "../actions"
import { LeadEditButton } from "./lead-edit-button"
import { LeadDetailActions } from "./lead-detail-actions"

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
  const [data, funnels, accountOptions] = await Promise.all([
    getLead(id),
    listFunnelsWithStages(),
    listAccountOptions(),
  ])
  if (!data) notFound()

  const { lead, stageName, funnelName, accountName, personName } = data
  const [activity, files] = await Promise.all([
    listActivities("lead", id),
    listEntityAttachments("lead", id),
  ])

  const detail: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: STATUS_LABEL[lead.status] ?? lead.status },
    { label: "Company", value: lead.companyName ?? "—" },
    {
      label: "Email",
      value: lead.email ? (
        <a
          href={`mailto:${lead.email}`}
          className="text-primary hover:underline"
        >
          {lead.email}
        </a>
      ) : (
        "—"
      ),
    },
    { label: "Phone", value: lead.phone ?? "—" },
    { label: "Source", value: lead.source ?? "—" },
    {
      label: "Funnel",
      value: funnelName ? (
        lead.convertedOpportunityId ? (
          <Link
            href={`/funnel/${lead.convertedOpportunityId}`}
            className="text-primary hover:underline"
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

  if (lead.status === "disqualified" && lead.disqualifyReason) {
    detail.push({ label: "Disqualify reason", value: lead.disqualifyReason })
  }

  const isConverted =
    !!lead.convertedAccountId ||
    !!lead.convertedPersonId ||
    !!lead.convertedOpportunityId

  // When the lead has its own pipeline stage, render a funnel progress below
  // the lead-status progress. Stages come from the already-loaded funnels
  // lookup (id/name/kind/sortOrder, ordered) — no extra fetch needed.
  const leadFunnelStages =
    lead.funnelId && lead.currentStageId
      ? funnels.find((f) => f.id === lead.funnelId)?.stages ?? null
      : null
  const funnelProgress =
    leadFunnelStages && lead.currentStageId
      ? buildFunnelSteps(leadFunnelStages, lead.currentStageId)
      : null

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
              <LeadDetailActions lead={lead} accountOptions={accountOptions} />
            ) : null}
            <LeadEditButton lead={lead} funnels={funnels} />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/leads" />}
            >
              Back to leads
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.map((d) => (
                    <div key={d.label} className="grid gap-1">
                      <dt className="text-xs text-muted-foreground">
                        {d.label}
                      </dt>
                      <dd className="text-sm">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
                <StageProgress {...buildLeadSteps(lead.status)} />
                {funnelProgress ? (
                  <div className="border-t pt-6">
                    <StageProgress {...funnelProgress} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {isConverted ? (
              <Card>
                <CardHeader>
                  <CardTitle>Converted</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {lead.convertedAccountId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link href={`/accounts/${lead.convertedAccountId}`} />
                        }
                      >
                        Account{accountName ? `: ${accountName}` : ""}
                      </Button>
                    ) : null}
                    {lead.convertedPersonId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link href={`/persons/${lead.convertedPersonId}`} />
                        }
                      >
                        Contact{personName ? `: ${personName}` : ""}
                      </Button>
                    ) : null}
                    {lead.convertedOpportunityId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/funnel/${lead.convertedOpportunityId}`}
                          />
                        }
                      >
                        Funnel{funnelName ? `: ${funnelName}` : ""}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityTimeline
                  entityType="lead"
                  entityId={id}
                  items={activity}
                  revalidate={`/leads/${id}`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <AttachmentsPanel
                  attachableType="lead"
                  attachableId={id}
                  items={files}
                  revalidate={`/leads/${id}`}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}
