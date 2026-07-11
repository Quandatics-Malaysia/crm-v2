"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { InlineValue } from "@/components/inline-value"
import { showActionError } from "@/lib/show-action-error"
import { formatDate } from "@/lib/format"
import { ProjectSalesOrders } from "@/app/(app)/sales-orders/project-sales-orders"
import { updateProject, type ProjectUpdateInput } from "../actions"
import { MilestonesPanel } from "./milestones-panel"
import { BillingPanel } from "./billing-panel"
import type { ProjectBillingSummary } from "@/app/(app)/billing/actions"

/** Raw scalar fields the page marks inline-editable (Salesforce-style). */
export type ProjectEditKey = "name" | "startDate"

export type ProjectDetailData = {
  projectId: string
  fields: { label: string; value: React.ReactNode; editKey?: ProjectEditKey }[]
  /** Raw values behind the inline-editable fields (updateProject is patch-style). */
  record: { name: string; startDate: string | null }
  notes: string | null
  milestones: React.ComponentProps<typeof MilestonesPanel>["milestones"]
  projectValue: string | null
  currency: string
  canManage: boolean
  salesOrders: React.ComponentProps<typeof ProjectSalesOrders>["orders"]
  /** Whether the sales-orders plugin is enabled (gates the Sales orders tab). */
  salesOrdersEnabled: boolean
  canSubmit: boolean
  canApprove: boolean
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
  /** Finance-module billing rollup; null when the module is off. */
  billing?: ProjectBillingSummary | null
  canManageFinance?: boolean
}

/** Project detail: a details panel on the left; tabbed Milestones / Sales
 *  orders / Activity / Documents on the right. */
export function ProjectDetailBody({
  projectId,
  fields,
  record,
  notes,
  milestones,
  projectValue,
  currency,
  canManage,
  salesOrders,
  salesOrdersEnabled,
  canSubmit,
  canApprove,
  activity,
  documents,
  billing = null,
  canManageFinance = false,
}: ProjectDetailData) {
  const [tab, setTab] = React.useState("milestones")
  const router = useRouter()
  const revalidate = `/projects/${projectId}`

  async function saveField(patch: ProjectUpdateInput) {
    const res = await updateProject(projectId, patch)
    if (!res.ok) {
      showActionError(res)
      return
    }
    router.refresh()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — project details */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="project" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Project</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {fields.map((d) => {
              const key = canManage ? d.editKey : undefined
              return (
                <div key={d.label} className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{d.label}</span>
                  <span className="text-sm">
                    {!key ? (
                      d.value
                    ) : key === "startDate" ? (
                      <InlineValue
                        value={record.startDate ?? ""}
                        display={formatDate(record.startDate)}
                        formatDraft={(v) => (v ? formatDate(v) : "—")}
                        type="date"
                        title="Click to edit start date"
                        onSave={(next) => saveField({ startDate: next || null })}
                      />
                    ) : (
                      <InlineValue
                        value={record.name}
                        display={record.name}
                        title="Click to edit name"
                        onSave={(next) => {
                          if (!next.trim()) return
                          return saveField({ name: next })
                        }}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                { kind: "milestone", label: "Milestones", count: milestones.length, onSelect: () => setTab("milestones") },
                ...(salesOrdersEnabled
                  ? [{ kind: "salesOrder" as const, label: "Sales orders", count: salesOrders.length, onSelect: () => setTab("orders") }]
                  : []),
                { kind: "document", label: "Documents", count: documents.length, onSelect: () => setTab("documents") },
              ]}
            />
          </CardContent>
        </Card>

        {notes ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {notes}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Right column — tabbed related lists */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="milestones">
                  Milestones
                  <Badge variant="secondary" className="ml-1.5">{milestones.length}</Badge>
                </TabsTrigger>
                {salesOrdersEnabled ? (
                  <TabsTrigger value="orders">
                    Sales orders
                    <Badge variant="secondary" className="ml-1.5">{salesOrders.length}</Badge>
                  </TabsTrigger>
                ) : null}
                {billing ? (
                  <TabsTrigger value="billing">
                    Billing
                    <Badge variant="secondary" className="ml-1.5">{billing.docs.length}</Badge>
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents
                  <Badge variant="secondary" className="ml-1.5">{documents.length}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="milestones" className="mt-4">
                <MilestonesPanel
                  projectId={projectId}
                  milestones={milestones}
                  projectValue={projectValue}
                  currency={currency}
                  canManage={canManage}
                />
              </TabsContent>

              {salesOrdersEnabled ? (
                <TabsContent value="orders" className="mt-4">
                  <ProjectSalesOrders
                    projectId={projectId}
                    orders={salesOrders}
                    canSubmit={canSubmit}
                    canApprove={canApprove}
                  />
                </TabsContent>
              ) : null}

              {billing ? (
                <TabsContent value="billing" className="mt-4">
                  <BillingPanel
                    summary={billing}
                    milestones={milestones}
                    canManage={canManageFinance}
                  />
                </TabsContent>
              ) : null}

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="project"
                  entityId={projectId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="project"
                  uploadId={projectId}
                  documents={documents}
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
