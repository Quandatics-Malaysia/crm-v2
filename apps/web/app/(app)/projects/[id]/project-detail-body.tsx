"use client"

import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TabsContent, TabsList } from "@/components/ui/tabs"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import {
  DetailAside,
  DetailCardHeader,
  DetailTabs,
  RelatedCard,
  CountTab,
  FieldRow,
  useSaveField,
} from "@/components/detail-page"
import { InlineValue } from "@/components/inline-value"
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
}: ProjectDetailData) {
  const [tab, setTab] = React.useState("milestones")
  const revalidate = `/projects/${projectId}`

  // updateProject is patch-style: send only the changed field.
  const saveField = useSaveField((patch: ProjectUpdateInput) =>
    updateProject(projectId, patch)
  )


  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — project details */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="project" eyebrow="Project" />
          <CardContent className="grid gap-3 text-sm">
            {fields.map((d) => {
              const key = canManage ? d.editKey : undefined
              return (
                <FieldRow key={d.label} label={d.label}>
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
                </FieldRow>
              )
            })}
          </CardContent>
        </Card>

        <RelatedCard
          items={[
            { kind: "milestone", label: "Milestones", count: milestones.length, onSelect: () => setTab("milestones") },
            ...(salesOrdersEnabled
              ? [{ kind: "salesOrder" as const, label: "Sales orders", count: salesOrders.length, onSelect: () => setTab("orders") }]
              : []),
            { kind: "document", label: "Documents", count: documents.length, onSelect: () => setTab("documents") },
          ]}
        />

        {notes || canManage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <InlineValue
                  value={notes ?? ""}
                  multiline
                  display={
                    <span className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {notes || "Add notes"}
                    </span>
                  }
                  title="Click to edit notes"
                  onSave={(next) => saveField({ notes: next || null })}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {notes}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </DetailAside>

      {/* Right column — tabbed related lists */}
      <DetailTabs value={tab} onValueChange={setTab}>
        <TabsList>
          <CountTab value="milestones" count={milestones.length}>
            Milestones
          </CountTab>
          {salesOrdersEnabled ? (
            <CountTab value="orders" count={salesOrders.length}>
              Sales orders
            </CountTab>
          ) : null}
          {billing ? (
            <CountTab value="billing" count={billing.docs.length}>
              Billing
            </CountTab>
          ) : null}
          <CountTab value="activity">Activity</CountTab>
          <CountTab value="documents" count={documents.length}>
            Documents
          </CountTab>
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
      </DetailTabs>
    </div>
  )
}
