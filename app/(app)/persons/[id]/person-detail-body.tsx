"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { showActionError } from "@/lib/show-action-error"
import { StageBadge } from "@/app/(app)/funnel/stage-badge"
import { formatMoney } from "@/lib/format"
import {
  updatePerson,
  type PersonInput,
  type PersonOpportunity,
  type PersonProject,
} from "../actions"

// Status pills render via the app-wide <StatusBadge> tone map.

/** Raw scalar fields the page marks inline-editable (Salesforce-style). */
export type PersonEditKey =
  | "firstName"
  | "lastName"
  | "title"
  | "email"
  | "phone"
  | "accountId"

export type PersonDetailSection = {
  title: string
  fields: { label: string; value: React.ReactNode; editKey?: PersonEditKey }[]
}

export type PersonDetailData = {
  personId: string
  sections: PersonDetailSection[]
  /** Raw field values — updatePerson is full-replace, so each inline save
   *  merges the one edited field into this snapshot. */
  record: PersonInput
  /** Gates every inline editor (PERSON_UPDATE, resolved server-side). */
  canEdit: boolean
  /** Account picker options for the linked-account inline combobox. */
  accounts: { id: string; name: string }[]
  funnels: PersonOpportunity[]
  projects: PersonProject[]
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
}

/** Contact detail: a highlights + related-links panel on the left; tabbed
 *  Funnels / Projects / Activity / Documents on the right (each top-5 + search). */
export function PersonDetailBody({
  personId,
  sections,
  record,
  canEdit,
  accounts,
  funnels,
  projects,
  activity,
  documents,
}: PersonDetailData) {
  const [tab, setTab] = React.useState("pipelines")
  const router = useRouter()
  const revalidate = `/persons/${personId}`

  async function saveField(patch: Partial<PersonInput>) {
    const res = await updatePerson(personId, { ...record, ...patch })
    if (!res.ok) {
      showActionError(res)
      return
    }
    router.refresh()
  }

  const accountOptions = React.useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts]
  )

  const funnelColumns = React.useMemo<ColumnDef<PersonOpportunity>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: ({ row }) => (
          <Link
            href={`/funnel/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) =>
          row.original.stageName ? (
            <StageBadge
              kind={row.original.stageKind}
              name={row.original.stageName}
              probability={row.original.stageProbability}
            />
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "amount",
        header: () => <div className="text-right">Value</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {row.original.amount
              ? formatMoney(row.original.amount, row.original.currency)
              : "—"}
          </div>
        ),
      },
    ],
    []
  )

  const projectColumns = React.useMemo<ColumnDef<PersonProject>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link href={`/projects/${row.original.id}`} className="font-medium link">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "projectCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.projectCode}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — contact highlights + related quick links */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="contact" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Contact</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 text-sm">
            {sections.map((section) => (
              <section key={section.title} className="grid gap-3">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                {section.fields.map((d) => {
                  const key = canEdit ? d.editKey : undefined
                  return (
                    <div key={d.label} className="grid gap-1">
                      <span className="text-xs text-muted-foreground">
                        {d.label}
                      </span>
                      <span className="text-sm">
                        {!key ? (
                          d.value
                        ) : key === "accountId" ? (
                          <InlineCombobox
                            value={record.accountId}
                            display={
                              accountOptions.find((o) => o.value === record.accountId)
                                ?.label ?? "—"
                            }
                            options={accountOptions}
                            onSave={(next) => saveField({ accountId: next })}
                            searchPlaceholder="Search accounts…"
                            emptyMessage="No accounts found."
                            title="Click to change account"
                          />
                        ) : (
                          <InlineValue
                            value={record[key] ?? ""}
                            display={record[key] || "—"}
                            title={`Click to edit ${d.label.toLowerCase()}`}
                            onSave={(next) => {
                              // First name is required — ignore an emptied draft.
                              if (key === "firstName") {
                                if (!next.trim()) return
                                return saveField({ firstName: next })
                              }
                              return saveField({ [key]: next || null })
                            }}
                          />
                        )}
                      </span>
                    </div>
                  )
                })}
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
                { kind: "funnel", label: "Funnels", count: funnels.length, onSelect: () => setTab("pipelines") },
                { kind: "project", label: "Projects", count: projects.length, onSelect: () => setTab("projects") },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right column — tabbed related lists */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="pipelines">
                  Funnels
                  <Badge variant="secondary" className="ml-1.5">
                    {funnels.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="projects">
                  Projects
                  <Badge variant="secondary" className="ml-1.5">
                    {projects.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents
                  <Badge variant="secondary" className="ml-1.5">
                    {documents.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pipelines" className="mt-4">
                <DataTable
                  columns={funnelColumns}
                  data={funnels}
                  tableId="person-pipelines"
                  searchColumn="name"
                  searchPlaceholder="Search pipelines…"
                  emptyMessage="No pipelines for this contact yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="projects" className="mt-4">
                <DataTable
                  columns={projectColumns}
                  data={projects}
                  tableId="person-projects"
                  searchColumn="name"
                  searchPlaceholder="Search projects…"
                  emptyMessage="No projects for this contact yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="person"
                  entityId={personId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="person"
                  uploadId={personId}
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
