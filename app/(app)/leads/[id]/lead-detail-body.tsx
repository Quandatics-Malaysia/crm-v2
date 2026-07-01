"use client"

import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { type ProgressStep } from "@/components/stage-progress"
import {
  StagePathView,
  type PathStep,
  type PathNote,
} from "@/components/stage-path-view"

/** Map the dot-stepper steps onto the shared chevron-path steps. */
function toPathSteps(steps: ProgressStep[]): PathStep[] {
  return steps.map((s) => ({
    id: s.id,
    label: s.label,
    state: s.state === "terminal" ? "upcoming" : s.state,
    tone: s.tone,
  }))
}

export type LeadConverted = {
  accountId: string | null
  accountName: string | null
  personId: string | null
  personName: string | null
  opportunityId: string | null
  funnelName: string | null
}

export type LeadDetailData = {
  leadId: string
  fields: { label: string; value: React.ReactNode }[]
  leadSteps: ProgressStep[]
  leadNote: PathNote
  funnelSteps: ProgressStep[] | null
  funnelNote: PathNote
  converted: LeadConverted | null
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  files: React.ComponentProps<typeof AttachmentsPanel>["items"]
}

/** Lead detail: a details panel + conversion links on the left; the lead/funnel
 *  progress and tabbed Activity/Documents on the right. */
export function LeadDetailBody({
  leadId,
  fields,
  leadSteps,
  leadNote,
  funnelSteps,
  funnelNote,
  converted,
  activity,
  files,
}: LeadDetailData) {
  const [tab, setTab] = React.useState("activity")
  const revalidate = `/leads/${leadId}`

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — details + conversion links */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="lead" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Lead</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {fields.map((d) => (
              <div key={d.label} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{d.label}</span>
                <span className="text-sm">{d.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {converted &&
        (converted.accountId ||
          converted.personId ||
          converted.opportunityId) ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Related</CardTitle>
            </CardHeader>
            <CardContent>
              <RelatedQuickLinks
                items={[
                  ...(converted.accountId
                    ? [
                        {
                          kind: "account" as const,
                          label: converted.accountName ?? "Account",
                          href: `/accounts/${converted.accountId}`,
                        },
                      ]
                    : []),
                  ...(converted.personId
                    ? [
                        {
                          kind: "contact" as const,
                          label: converted.personName ?? "Contact",
                          href: `/persons/${converted.personId}`,
                        },
                      ]
                    : []),
                  ...(converted.opportunityId
                    ? [
                        {
                          kind: "funnel" as const,
                          label: converted.funnelName ?? "Funnel",
                          href: `/funnel/${converted.opportunityId}`,
                        },
                      ]
                    : []),
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Right column — progress + tabbed Activity / Documents */}
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <StagePathView steps={toPathSteps(leadSteps)} note={leadNote} />
            {funnelSteps ? (
              <div className="border-t pt-6">
                <StagePathView
                  steps={toPathSteps(funnelSteps)}
                  note={funnelNote}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents
                  <Badge variant="secondary" className="ml-1.5">
                    {files.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="lead"
                  entityId={leadId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <AttachmentsPanel
                  attachableType="lead"
                  attachableId={leadId}
                  items={files}
                  revalidate={revalidate}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
