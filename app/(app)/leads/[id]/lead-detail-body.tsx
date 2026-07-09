"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection, type SectionDocument } from "@/components/documents-section"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import { type ProgressStep } from "@/components/stage-progress"
import { showActionError } from "@/lib/show-action-error"
import {
  StagePathView,
  type PathStep,
  type PathStepState,
  type PathNote,
} from "@/components/stage-path-view"
import { setLeadStatus, setLeadStage } from "../actions"

/** Map the dot-stepper steps onto the shared chevron-path steps, marking which
 *  segments are clickable via the supplied predicate. */
function toPathSteps(
  steps: ProgressStep[],
  isClickable: (id: string, state: PathStepState) => boolean
): PathStep[] {
  return steps.map((s) => {
    const state: PathStepState = s.state === "terminal" ? "upcoming" : s.state
    return {
      id: s.id,
      label: s.label,
      state,
      tone: s.tone,
      clickable: isClickable(s.id, state),
    }
  })
}

export type LeadConverted = {
  accountId: string | null
  accountName: string | null
  personId: string | null
  personName: string | null
  funnelId: string | null
  funnelName: string | null
}

export type LeadDetailSection = {
  title: string
  fields: { label: string; value: React.ReactNode }[]
}

export type LeadDetailData = {
  leadId: string
  status: string
  sections: LeadDetailSection[]
  leadSteps: ProgressStep[]
  leadNote: PathNote
  funnelSteps: ProgressStep[] | null
  funnelNote: PathNote
  converted: LeadConverted | null
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  files: SectionDocument[]
}

/** Lead detail: a details panel + conversion links on the left; the lead/funnel
 *  progress and tabbed Activity/Documents on the right. */
export function LeadDetailBody({
  leadId,
  status,
  sections,
  leadSteps,
  leadNote,
  funnelSteps,
  funnelNote,
  converted,
  activity,
  files,
}: LeadDetailData) {
  const [tab, setTab] = React.useState("activity")
  const router = useRouter()
  const perms = usePermissions()
  const canUpdate = perms.has(PERMISSIONS.LEAD_UPDATE)
  const revalidate = `/leads/${leadId}`

  // Converted/disqualified leads are terminal — their status is locked.
  const terminal = status === "converted" || status === "disqualified"
  const interactive = canUpdate && !terminal
  // Only the pre-outcome statuses are click-settable; Convert/Disqualify have
  // their own flows in the page header.
  const STATUS_SETTABLE = ["new", "contacted", "qualified"]

  async function changeStatus(next: string) {
    const res = await setLeadStatus(leadId, next)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Lead status updated")
    router.refresh()
  }

  async function changeFunnelStage(stageId: string) {
    const res = await setLeadStage(leadId, stageId)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Stage updated")
    router.refresh()
  }

  const leadPathSteps = toPathSteps(
    leadSteps,
    (id, state) =>
      interactive && STATUS_SETTABLE.includes(id) && state !== "current"
  )
  const funnelPathSteps = funnelSteps
    ? toPathSteps(funnelSteps, (_id, state) => interactive && state !== "current")
    : null

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
          <CardContent className="grid gap-5 text-sm">
            {sections.map((section) => (
              <section key={section.title} className="grid gap-3">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                {section.fields.map((d) => (
                  <div key={d.label} className="grid gap-1">
                    <span className="text-xs text-muted-foreground">
                      {d.label}
                    </span>
                    <span className="text-sm">{d.value}</span>
                  </div>
                ))}
              </section>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                ...(converted?.accountId
                  ? [
                      {
                        kind: "account" as const,
                        label: converted.accountName ?? "Account",
                        href: `/accounts/${converted.accountId}`,
                      },
                    ]
                  : []),
                ...(converted?.personId
                  ? [
                      {
                        kind: "contact" as const,
                        label: converted.personName ?? "Contact",
                        href: `/persons/${converted.personId}`,
                      },
                    ]
                  : []),
                ...(converted?.funnelId
                  ? [
                      {
                        kind: "funnel" as const,
                        label: converted.funnelName ?? "Opportunity",
                        href: `/opportunities/${converted.funnelId}`,
                      },
                    ]
                  : []),
                {
                  kind: "document" as const,
                  label: "Documents",
                  count: files.length,
                  onSelect: () => setTab("documents"),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right column — progress + tabbed Activity / Documents */}
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <StagePathView
              steps={leadPathSteps}
              note={leadNote}
              hint={
                interactive && !leadNote
                  ? "Click a stage to update the lead status."
                  : undefined
              }
              onStepClick={interactive ? changeStatus : undefined}
            />
            {funnelPathSteps ? (
              <div className="border-t pt-6">
                <StagePathView
                  steps={funnelPathSteps}
                  note={funnelNote}
                  hint={
                    interactive && !funnelNote
                      ? "Click a stage to move the lead's funnel."
                      : undefined
                  }
                  onStepClick={interactive ? changeFunnelStage : undefined}
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
                <DocumentsSection
                  uploadType="lead"
                  uploadId={leadId}
                  documents={files}
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
