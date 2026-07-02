"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import { STAGE_SOURCE_LABELS } from "@/lib/status-meta"
import { Separator } from "@/components/ui/separator"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { cn } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { DocumentsSection } from "@/components/documents-section"
import { formatDate, formatMoney } from "@/lib/format"
import {
  formatCustomFieldValue,
  groupCustomFields,
  type StageGate,
  type CustomFunnelField,
} from "@/lib/stage-gate"
import { StagePath } from "../stage-path"
import { StageBadge } from "../stage-badge"
import { CostsPanel } from "./costs-panel"
import { ContractPanel } from "./contract-panel"
import type {
  OpportunityDetail,
  OpportunityProjectRow,
  OpportunityProductRow,
} from "../actions"
import type { DealCostRow } from "../cost-actions"
import type { ContractYearRow } from "../contract-actions"

/**
 * The Cost & margin tracker is hidden for now — the model isn't mature and its
 * margin (quoted revenue − cost) doesn't reconcile with the intercompany
 * "recognized %" cut, which confuses more than it helps. The panel, actions and
 * schema are kept intact; flip this to re-enable once the model is settled.
 */
const SHOW_COST_MARGIN = false

/**
 * The multi-year Contract tracker is also hidden for now (same reasoning — not
 * mature yet). Panel/actions/schema are kept; flip to re-enable.
 */
const SHOW_CONTRACT = false

// Status pills render via the app-wide <StatusBadge> tone map; the stage-change
// source labels come from the shared status-meta module.

type StageLite = OpportunityDetail["funnelStagesList"][number]

export type FunnelDetailData = {
  opportunityId: string
  currentStageId: string
  stages: StageLite[]
  interactive: boolean
  accountId: string
  accountName: string | null
  ownerName: string | null
  personId: string | null
  personName: string | null
  /** Quoted amount (from the primary quotation). */
  quotedAmount: string | null
  /** Estimated Funnel Amount (manual) — drives the forecast. */
  estimatedAmount: string | null
  recognizedPercent: string | null
  currency: string
  quoteNumber: string | null
  status: string
  projectNatureName: string | null
  funnelName: string | null
  description: string | null
  projectYear: number | null
  isIntercompany: boolean
  handlingPartnerName: string | null
  /** Partner's accept/decline on the interco assignment (origin view). */
  partnerResponse: OpportunityDetail["partnerResponse"]
  expectedCloseDate: string | null
  createdAt: Date
  stageName: string
  stageKind: string
  stageProbability: string
  quotations: OpportunityDetail["quotations"]
  history: OpportunityDetail["history"]
  projects: OpportunityProjectRow[]
  products: OpportunityProductRow[]
  costs: DealCostRow[]
  /** Quoted revenue (base currency) margin is computed against. */
  costRevenue: number
  canManageCosts: boolean
  contractYears: ContractYearRow[]
  projectNatureNames: string[]
  /** Resolved per-stage entry gate (preset + custom field completeness). */
  gate: StageGate
  /** Tenant custom field definitions + this funnel's stored values. */
  customFieldDefs: CustomFunnelField[]
  customValues: Record<string, string>
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
}

/** Two-column detail: a rich details panel on the left, the clickable stage path
 *  plus a tabbed panel of related lists on the right (each top-5 + search). */
export function FunnelDetailBody(props: FunnelDetailData) {
  const {
    opportunityId,
    currentStageId,
    stages,
    interactive,
    accountId,
    accountName,
    ownerName,
    personId,
    personName,
    quotedAmount,
    estimatedAmount,
    recognizedPercent,
    currency,
    quoteNumber,
    status,
    projectNatureName,
    funnelName,
    description,
    projectYear,
    isIntercompany,
    handlingPartnerName,
    partnerResponse,
    expectedCloseDate,
    createdAt,
    stageName,
    stageKind,
    stageProbability,
    quotations,
    history,
    projects,
    products,
    costs,
    costRevenue,
    canManageCosts,
    contractYears,
    projectNatureNames,
    gate,
    customFieldDefs,
    customValues,
    activity,
    documents,
  } = props

  const [tab, setTab] = React.useState("activity")
  const revalidate = `/funnel/${opportunityId}`

  // Recognized Amount = deal value × Recognized % (the tenant's cut). Once a
  // primary quotation exists its net IS the deal's real value, so the quoted
  // amount becomes the basis; before any quote, the rep's estimate is all we
  // have. The label states which basis applied.
  const recognizedBasis = quotedAmount ?? estimatedAmount
  const recognizedBasisLabel = quotedAmount ? "quoted" : "estimated"
  const recognizedAmount = (
    (Number(recognizedBasis ?? 0) * Number(recognizedPercent ?? 0)) /
    100
  ).toFixed(2)

  const quoteColumns = React.useMemo<ColumnDef<(typeof quotations)[number]>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Number" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/quotations/${row.original.id}`}
              className="font-medium link"
            >
              {row.original.quoteNumber}
            </Link>
            {row.original.isPrimary ? (
              <Badge variant="outline">Primary</Badge>
            ) : null}
          </div>
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

  const projectColumns = React.useMemo<ColumnDef<OpportunityProjectRow>[]>(
    () => [
      {
        accessorKey: "projectCode",
        header: "Code",
        cell: ({ row }) => (
          <Link
            href={`/projects/${row.original.id}`}
            className="font-mono text-xs link"
          >
            {row.original.projectCode}
          </Link>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  )

  const productColumns = React.useMemo<ColumnDef<OpportunityProductRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Product" />,
        cell: ({ row }) => (
          <Link
            href={`/products/${row.original.productId}`}
            className="font-medium link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "productCode",
        header: "Line",
        cell: ({ row }) =>
          row.original.productCode ? (
            <span className="font-mono text-xs">{row.original.productCode}</span>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "uom",
        header: "UOM",
        cell: ({ row }) => row.original.uom ?? "—",
      },
      {
        accessorKey: "quoteCount",
        header: () => <div className="text-right">On quotes</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.quoteCount}</div>
        ),
      },
    ],
    []
  )

  const historyColumns = React.useMemo<ColumnDef<(typeof history)[number]>[]>(
    () => [
      {
        accessorKey: "toStageName",
        header: "Stage",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 text-sm">
            {row.original.fromStageName ? (
              <>
                <span className="text-muted-foreground">
                  {row.original.fromStageName}
                </span>
                <span className="text-muted-foreground">→</span>
              </>
            ) : null}
            <span className="font-medium">{row.original.toStageName}</span>
          </div>
        ),
      },
      {
        accessorKey: "changedAt",
        header: ({ column }) => <SortableHeader column={column} title="When" />,
        cell: ({ row }) => formatDate(row.original.changedAt),
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) =>
          STAGE_SOURCE_LABELS[row.original.source] ?? row.original.source,
      },
      {
        accessorKey: "changedByName",
        header: "By",
        cell: ({ row }) => row.original.changedByName ?? "—",
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — funnel highlights + related quick links */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="funnel" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Funnel</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Field label="Account">
              {accountName ? (
                <Link
                  href={`/accounts/${accountId}`}
                  className="font-medium link"
                >
                  {accountName}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Stage">
              <StageBadge
                name={stageName}
                kind={stageKind}
                probability={stageProbability}
              />
            </Field>
            <Field label="Status">
              <StatusBadge status={status} />
            </Field>

            <Separator />

            {/* Value breakdown: estimated (forecast) vs quoted vs recognized. */}
            <Field label="Estimated funnel amount">
              <span className="font-semibold tabular-nums">
                {estimatedAmount ? formatMoney(estimatedAmount, currency) : "—"}
              </span>
            </Field>
            <Field label="Quoted amount">
              {quotedAmount ? (
                <span className="tabular-nums">
                  {formatMoney(quotedAmount, currency)}
                  {quoteNumber ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      from {quoteNumber}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">No quotation yet</span>
              )}
            </Field>
            <Field label="Recognized">
              {recognizedPercent ? (
                <span className="tabular-nums">
                  {formatMoney(recognizedAmount, currency)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({Number(recognizedPercent)}% of {recognizedBasisLabel})
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>

            {isIntercompany ? (
              <Field label="Handling partner">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">Intercompany</Badge>
                  {handlingPartnerName ?? "—"}
                  {partnerResponse ? (
                    <Badge
                      variant={
                        partnerResponse.response === "accepted"
                          ? "default"
                          : "destructive"
                      }
                      title={partnerResponse.reason ?? undefined}
                    >
                      {partnerResponse.response === "accepted"
                        ? "Accepted"
                        : "Declined"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Awaiting response</Badge>
                  )}
                </span>
              </Field>
            ) : null}

            <Separator />

            <Field label="Owner">{ownerName ?? "—"}</Field>
            <Field label="Contact">
              {personId && personName ? (
                <Link
                  href={`/persons/${personId}`}
                  className="link"
                >
                  {personName}
                </Link>
              ) : (
                personName ?? "—"
              )}
            </Field>
            <Field label="Project nature(s)">
              {projectNatureNames.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {projectNatureNames.map((n) => (
                    <Badge key={n} variant="outline">
                      {n}
                    </Badge>
                  ))}
                </span>
              ) : (
                projectNatureName ?? "—"
              )}
            </Field>
            <Field label="Funnel">{funnelName ?? "—"}</Field>
            <Field label="Project / license year">{projectYear ?? "—"}</Field>
            <Field label="Expected close">{formatDate(expectedCloseDate)}</Field>
            <Field label="Created">{formatDate(createdAt)}</Field>
            {description ? (
              <Field label="Description">
                <span className="whitespace-pre-wrap">{description}</span>
              </Field>
            ) : null}

            {customFieldDefs.length > 0 ? (
              <>
                <Separator />
                {groupCustomFields(customFieldDefs).map((group) => (
                  <React.Fragment key={group.category ?? "__none__"}>
                    {group.category ? (
                      <div className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.category}
                      </div>
                    ) : null}
                    {group.fields.map((def) => (
                      <Field key={def.key} label={def.label}>
                        {formatCustomFieldValue(def, customValues[def.key])}
                      </Field>
                    ))}
                  </React.Fragment>
                ))}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                { kind: "quotation", label: "Quotations", count: quotations.length, onSelect: () => setTab("quotations") },
                { kind: "product", label: "Products", count: products.length, onSelect: () => setTab("products") },
                { kind: "project", label: "Projects", count: projects.length, onSelect: () => setTab("projects") },
                ...(SHOW_COST_MARGIN
                  ? [{ kind: "account" as const, label: "Costs & margin", count: costs.length, onSelect: () => setTab("costs") }]
                  : []),
                ...(SHOW_CONTRACT
                  ? [{ kind: "funnel" as const, label: "Contract", count: contractYears.length, onSelect: () => setTab("contract") }]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right column — stage path + tabbed related lists */}
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <StagePath
              opportunityId={opportunityId}
              currentStageId={currentStageId}
              stages={stages}
              interactive={interactive}
              gate={gate}
              customFieldDefs={customFieldDefs}
              customValues={customValues}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-auto flex-wrap justify-start gap-1 *:flex-none">

                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="quotations">
                  Quotations
                  <Badge variant="secondary" className="ml-1.5">
                    {quotations.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="products">
                  Products
                  <Badge variant="secondary" className="ml-1.5">
                    {products.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="projects">
                  Projects
                  <Badge variant="secondary" className="ml-1.5">
                    {projects.length}
                  </Badge>
                </TabsTrigger>
                {SHOW_COST_MARGIN ? (
                  <TabsTrigger value="costs">
                    Costs &amp; margin
                    <Badge variant="secondary" className="ml-1.5">
                      {costs.length}
                    </Badge>
                  </TabsTrigger>
                ) : null}
                {SHOW_CONTRACT ? (
                  <TabsTrigger value="contract">
                    Contract
                    <Badge variant="secondary" className="ml-1.5">
                      {contractYears.length}
                    </Badge>
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="history">Stage history</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents
                  <Badge variant="secondary" className="ml-1.5">
                    {documents.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="opportunity"
                  entityId={opportunityId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="quotations" className="mt-4">
                <DataTable
                  columns={quoteColumns}
                  data={quotations}
                  tableId="funnel-quotes"
                  searchColumn="quoteNumber"
                  searchPlaceholder="Search quotations…"
                  emptyMessage="No quotations yet."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="products" className="mt-4">
                <DataTable
                  columns={productColumns}
                  data={products}
                  tableId="funnel-products"
                  searchColumn="name"
                  searchPlaceholder="Search products…"
                  emptyMessage="No products offered yet — add products to a quotation."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="projects" className="mt-4">
                <DataTable
                  columns={projectColumns}
                  data={projects}
                  tableId="funnel-projects"
                  searchColumn="name"
                  searchPlaceholder="Search projects…"
                  emptyMessage="No projects from this funnel yet."
                  pageSize={5}
                />
              </TabsContent>

              {SHOW_COST_MARGIN ? (
                <TabsContent value="costs" className="mt-4">
                  <CostsPanel
                    opportunityId={opportunityId}
                    costs={costs}
                    revenue={costRevenue}
                    currency={currency}
                    canManage={canManageCosts}
                  />
                </TabsContent>
              ) : null}

              {SHOW_CONTRACT ? (
                <TabsContent value="contract" className="mt-4">
                  <ContractPanel
                    opportunityId={opportunityId}
                    years={contractYears}
                    currency={currency}
                    canManage={canManageCosts}
                  />
                </TabsContent>
              ) : null}

              <TabsContent value="history" className="mt-4">
                <DataTable
                  columns={historyColumns}
                  data={history}
                  tableId="funnel-history"
                  searchColumn="toStageName"
                  searchPlaceholder="Search stage history…"
                  emptyMessage="No stage changes recorded."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="opportunity"
                  uploadId={opportunityId}
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
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
