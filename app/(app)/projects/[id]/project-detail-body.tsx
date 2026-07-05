"use client"

import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { ProjectSalesOrders } from "@/app/(app)/sales-orders/project-sales-orders"
import { MilestonesPanel } from "./milestones-panel"
import { BillingPanel } from "./billing-panel"
import type { ProjectBillingSummary } from "@/app/(app)/billing/actions"

export type ProjectDetailData = {
  projectId: string
  fields: { label: string; value: React.ReactNode }[]
  notes: string | null
  milestones: React.ComponentProps<typeof MilestonesPanel>["milestones"]
  projectValue: string | null
  currency: string
  canManage: boolean
  salesOrders: React.ComponentProps<typeof ProjectSalesOrders>["orders"]
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
  notes,
  milestones,
  projectValue,
  currency,
  canManage,
  salesOrders,
  canSubmit,
  canApprove,
  activity,
  documents,
  billing = null,
  canManageFinance = false,
}: ProjectDetailData) {
  const [tab, setTab] = React.useState("milestones")
  const revalidate = `/projects/${projectId}`

  return (
    <div className="grid gap-4 lg:grid-cols-3">
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
            {fields.map((d) => (
              <div key={d.label} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{d.label}</span>
                <span className="text-sm">{d.value}</span>
              </div>
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
                { kind: "milestone", label: "Milestones", count: milestones.length, onSelect: () => setTab("milestones") },
                { kind: "salesOrder", label: "Sales orders", count: salesOrders.length, onSelect: () => setTab("orders") },
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
              <TabsList className="flex-wrap">
                <TabsTrigger value="milestones">
                  Milestones
                  <Badge variant="secondary" className="ml-1.5">{milestones.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="orders">
                  Sales orders
                  <Badge variant="secondary" className="ml-1.5">{salesOrders.length}</Badge>
                </TabsTrigger>
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

              <TabsContent value="orders" className="mt-4">
                <ProjectSalesOrders
                  projectId={projectId}
                  orders={salesOrders}
                  canSubmit={canSubmit}
                  canApprove={canApprove}
                />
              </TabsContent>

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
