"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { cn } from "@/lib/utils"
import { formatMoney, formatPercent } from "@/lib/format"
import type { PersonOpportunity, PersonProject } from "../actions"

// Status pills render via the app-wide <StatusBadge> tone map.

function stageKindClasses(kind: string | null): string {
  switch (kind) {
    case "WON":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
    case "LOST":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
    case "PARKED":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
    default:
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
  }
}

export type PersonDetailSection = {
  title: string
  fields: { label: string; value: React.ReactNode }[]
}

export type PersonDetailData = {
  personId: string
  sections: PersonDetailSection[]
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
  funnels,
  projects,
  activity,
  documents,
}: PersonDetailData) {
  const [tab, setTab] = React.useState("pipelines")
  const revalidate = `/persons/${personId}`

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
            <Badge className={cn(stageKindClasses(row.original.stageKind))}>
              <span>{row.original.stageName}</span>
              {row.original.stageProbability != null ? (
                <span className="opacity-70">
                  · {formatPercent(row.original.stageProbability)}
                </span>
              ) : null}
            </Badge>
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
    <div className="grid gap-4 lg:grid-cols-3">
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
              <TabsList className="h-auto flex-wrap justify-start gap-1 *:flex-none">
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
