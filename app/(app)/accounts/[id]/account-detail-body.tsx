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
import { formatMoney } from "@/lib/format"
import { AccountContacts } from "./account-contacts"
import type {
  AccountFunnelItem,
  AccountOpportunityItem,
  AccountProjectItem,
  AccountQuotationItem,
  PersonRow,
} from "../actions"

/** Tailwind class set per stage kind. Kind drives semantics, never the label. */
function stageKindClasses(kind: string): string {
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

// Status pills render via the app-wide <StatusBadge> tone map.

export type AccountChild = {
  id: string
  name: string
  accountType: string | null
}

export type AccountDetailData = {
  accountId: string
  fields: { label: string; value: React.ReactNode }[]
  contacts: PersonRow[]
  opportunities: AccountOpportunityItem[]
  pipelines: AccountFunnelItem[]
  projects: AccountProjectItem[]
  quotations: AccountQuotationItem[]
  childAccounts: AccountChild[]
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
}

/** Salesforce-style account detail: highlights + related quick-links on the
 *  left, a tabbed panel of related lists (top 5 + search) on the right. */
export function AccountDetailBody(props: AccountDetailData) {
  const {
    accountId,
    fields,
    contacts,
    opportunities,
    pipelines,
    projects,
    quotations,
    childAccounts,
    activity,
    documents,
  } = props

  const [tab, setTab] = React.useState("contacts")
  const revalidate = `/accounts/${accountId}`

  const opportunityColumns = React.useMemo<ColumnDef<AccountOpportunityItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Opportunity" />,
        cell: ({ row }) => (
          <Link href={`/opportunities/${row.original.id}`} className="font-medium link">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: "funnelCount",
        header: "Funnels",
        cell: ({ row }) => (
          <Badge variant="secondary" className="tabular-nums">
            {row.original.funnelCount}
          </Badge>
        ),
      },
      {
        accessorKey: "totalEstimatedFunnelAmount",
        header: () => <div className="text-right">Value</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatMoney(row.original.totalEstimatedFunnelAmount, row.original.currency)}
          </div>
        ),
      },
    ],
    []
  )

  const funnelColumns = React.useMemo<ColumnDef<AccountFunnelItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: ({ row }) => (
          <Link
            href={`/funnel/${row.original.funnelId}`}
            className="font-medium link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) => (
          <Badge className={cn(stageKindClasses(row.original.stageKind))}>
            <span className="font-mono uppercase opacity-70">
              {row.original.stageCode}
            </span>
            <span>{row.original.stageName}</span>
          </Badge>
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

  const projectColumns = React.useMemo<ColumnDef<AccountProjectItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            href={`/projects/${row.original.id}`}
            className="font-medium link"
          >
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

  const quotationColumns = React.useMemo<ColumnDef<AccountQuotationItem>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Quote" />,
        cell: ({ row }) => (
          <Link
            href={`/quotations/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.quoteNumber}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "total",
        header: () => <div className="text-right">Total</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatMoney(row.original.total, row.original.currency)}
          </div>
        ),
      },
    ],
    []
  )

  const childColumns = React.useMemo<ColumnDef<AccountChild>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            href={`/accounts/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "accountType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.accountType === "reseller" ? "Reseller" : "Client"}
          </Badge>
        ),
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — account highlights + related quick links */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="account" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Account</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {fields.map((d) => (
              <Field key={d.label} label={d.label}>
                {d.value}
              </Field>
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
                { kind: "contact", label: "Contacts", count: contacts.length, onSelect: () => setTab("contacts") },
                { kind: "opportunity", label: "Opportunities", count: opportunities.length, onSelect: () => setTab("opportunities") },
                { kind: "funnel", label: "Funnels", count: pipelines.length, onSelect: () => setTab("pipelines") },
                { kind: "project", label: "Projects", count: projects.length, onSelect: () => setTab("projects") },
                { kind: "quotation", label: "Quotations", count: quotations.length, onSelect: () => setTab("quotations") },
                { kind: "account", label: "Child accounts", count: childAccounts.length, onSelect: () => setTab("children") },
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
                <TabsTrigger value="contacts">
                  Contacts
                  <Badge variant="secondary" className="ml-1.5">
                    {contacts.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="opportunities">
                  Opportunities
                  <Badge variant="secondary" className="ml-1.5">
                    {opportunities.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="pipelines">
                  Funnels
                  <Badge variant="secondary" className="ml-1.5">
                    {pipelines.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="projects">
                  Projects
                  <Badge variant="secondary" className="ml-1.5">
                    {projects.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="quotations">
                  Quotations
                  <Badge variant="secondary" className="ml-1.5">
                    {quotations.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="children">
                  Child accounts
                  <Badge variant="secondary" className="ml-1.5">
                    {childAccounts.length}
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

              <TabsContent value="contacts" className="mt-4">
                <AccountContacts accountId={accountId} contacts={contacts} />
              </TabsContent>

              <TabsContent value="opportunities" className="mt-4">
                <DataTable
                  columns={opportunityColumns}
                  data={opportunities}
                  tableId="account-opportunities"
                  searchColumn="name"
                  searchPlaceholder="Search opportunities…"
                  emptyMessage="No opportunities for this account yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="pipelines" className="mt-4">
                <DataTable
                  columns={funnelColumns}
                  data={pipelines}
                  tableId="account-pipelines"
                  searchColumn="name"
                  searchPlaceholder="Search pipelines…"
                  emptyMessage="No pipelines for this account yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="projects" className="mt-4">
                <DataTable
                  columns={projectColumns}
                  data={projects}
                  tableId="account-projects"
                  searchColumn="name"
                  searchPlaceholder="Search projects…"
                  emptyMessage="No projects for this account yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="quotations" className="mt-4">
                <DataTable
                  columns={quotationColumns}
                  data={quotations}
                  tableId="account-quotations"
                  searchColumn="quoteNumber"
                  searchPlaceholder="Search quotations…"
                  emptyMessage="No quotations for this account yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="children" className="mt-4">
                <DataTable
                  columns={childColumns}
                  data={childAccounts}
                  tableId="account-children"
                  searchColumn="name"
                  searchPlaceholder="Search child accounts…"
                  emptyMessage="No child accounts."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="account"
                  entityId={accountId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="account"
                  uploadId={accountId}
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

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
