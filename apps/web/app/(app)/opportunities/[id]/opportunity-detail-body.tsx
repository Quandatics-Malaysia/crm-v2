"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DataTable,
  SortableHeader,
  rightHeader,
  moneyCell,
  linkCell,
} from "@/components/data-table"
import {
  DetailAside,
  DetailCardHeader,
  DetailTabs,
  RelatedCard,
  CountTab,
  useSaveField,
  FieldRow,
} from "@/components/detail-page"
import { DocumentsSection } from "@/components/documents-section"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { ChangeHistory } from "@/components/activity/change-history"
import type { ActivityRow } from "@/app/(app)/_shared/activity-actions"
import { formatMoney, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  updateOpportunityContainer,
  type OpportunityContainerDetail,
  type OpportunityContainerUpdateInput,
} from "../actions"

type FunnelRow = OpportunityContainerDetail["funnels"][number]
type QuoteRow = OpportunityContainerDetail["quotations"][number]
type ProductRow = OpportunityContainerDetail["products"][number]

const PPVVC: { key: "pain" | "power" | "vision" | "value" | "control"; label: string }[] = [
  { key: "power", label: "1-P: Power Sponsor" },
  { key: "pain", label: "2-P: Pain" },
  { key: "vision", label: "3-V: Vision" },
  { key: "value", label: "4-V: Value" },
  { key: "control", label: "5-C: Control" },
]

function stageVariant(kind: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (kind === "WON") return "default"
  if (kind === "LOST") return "destructive"
  if (kind === "PARKED") return "outline"
  return "secondary"
}

export function OpportunityDetailBody({
  detail,
  documents,
  projectNatures,
  newFunnelButton,
  persons,
  canEdit,
  initialTab,
  changes,
}: {
  detail: OpportunityContainerDetail
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
  projectNatures: { code: string; name: string }[]
  newFunnelButton?: React.ReactNode
  /** For the Owner/Power Sponsor contact pickers — scoped to this opportunity's account. */
  persons: { id: string; name: string; accountId: string }[]
  /** Whether the caller can edit this Opportunity (OPPORTUNITY_UPDATE) — gates every inline editor. */
  canEdit: boolean
  /** Deep-linked tab (?tab=analysis from the stage-gate checklist). */
  initialTab?: string
  /** Field-level change history for this Opportunity container. */
  changes: ActivityRow[]
}) {
  const TABS = ["funnels", "quotations", "products", "analysis", "remarks", "documents", "history"]
  const [tab, setTab] = React.useState(
    initialTab && TABS.includes(initialTab) ? initialTab : "funnels"
  )
  const o = detail.opportunity

  // updateOpportunityContainer is patch-style: send only the changed field.
  const saveField = useSaveField((patch: OpportunityContainerUpdateInput) =>
    updateOpportunityContainer(o.id, patch)
  )

  const revalidate = `/opportunities/${o.id}`

  const contactOptions = React.useMemo(
    () =>
      persons
        .filter((p) => p.accountId === detail.accountId)
        .map((p) => ({ value: p.id, label: p.name })),
    [persons, detail.accountId]
  )

  // "(T) - Training" — Salesforce's picklist display format.
  const natureLabel = (code: string) => {
    const name = projectNatures.find((p) => p.code === code)?.name ?? code
    return `(${code}) - ${name}`
  }
  const selectedNatures = o.projectNatures ?? (o.projectNatureCode ? [o.projectNatureCode] : [])
  const natureLabels = selectedNatures.map(natureLabel)

  // Single-select (radio-style): picking a pill replaces the selection;
  // clicking the selected pill clears it.
  function toggleNature(code: string) {
    saveField({ projectNatures: selectedNatures.includes(code) ? [] : [code] })
  }

  const funnelColumns = React.useMemo<ColumnDef<FunnelRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: linkCell<FunnelRow>(
          (r) => `/funnel/${r.id}`,
          (r) => r.name
        ),
      },
      {
        accessorKey: "stageName",
        header: "Stage",
        cell: ({ row }) => (
          <Badge variant={stageVariant(row.original.stageKind)}>
            {row.original.stageName ?? row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "estimatedAmount",
        header: ({ column }) => <SortableHeader column={column} title="Est. amount" />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.estimatedAmount, row.original.currency)}
          </span>
        ),
      },
    ],
    []
  )

  const quoteColumns = React.useMemo<ColumnDef<QuoteRow>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Quote" />,
        cell: linkCell<QuoteRow>(
          (r) => `/quotations/${r.id}`,
          (r) => r.quoteNumber
        ),
      },
      {
        accessorKey: "funnelName",
        header: "Funnel",
        cell: ({ row }) => (
          <Link href={`/funnel/${row.original.funnelId}`} className="link">
            {row.original.funnelName}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
      },
      {
        accessorKey: "total",
        header: rightHeader("Total"),
        cell: moneyCell<QuoteRow>(
          (r) => r.total,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  const productColumns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: "description",
        header: ({ column }) => <SortableHeader column={column} title="Product" />,
        cell: ({ row }) => (
          <span className="max-w-md truncate">{row.original.description ?? "—"}</span>
        ),
      },
      {
        accessorKey: "funnelName",
        header: "Funnel",
        cell: ({ row }) => (
          <Link href={`/funnel/${row.original.funnelId}`} className="link">
            {row.original.funnelName}
          </Link>
        ),
      },
      {
        accessorKey: "productCategory",
        header: "Category",
        cell: ({ row }) => row.original.productCategory ?? "—",
      },
      {
        accessorKey: "quantity",
        header: rightHeader("Qty"),
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{Number(row.original.quantity)}</div>
        ),
      },
      {
        accessorKey: "unitPrice",
        header: rightHeader("Unit price"),
        cell: moneyCell<ProductRow>(
          (r) => r.unitPrice,
          () => o.currency
        ),
      },
    ],
    [o.currency]
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — opportunity highlights */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="opportunity" eyebrow="Opportunity" />
          <CardContent className="grid gap-3 text-sm">
            <FieldRow inline label="Code">
              <span className="font-mono text-xs">{o.code}</span>
            </FieldRow>
            <FieldRow inline label="Name">
              {canEdit ? (
                <InlineValue
                  value={o.name}
                  display={o.name}
                  title="Click to edit name"
                  onSave={(next) => {
                    if (!next.trim()) return
                    return saveField({ name: next })
                  }}
                  className="font-medium"
                />
              ) : (
                <span className="font-medium">{o.name}</span>
              )}
            </FieldRow>
            <FieldRow inline label="Account">
              <Link href={`/accounts/${detail.accountId}`} className="font-medium link">
                {detail.accountName}
              </Link>
            </FieldRow>
            <FieldRow inline label="Owner">{detail.ownerName ?? "—"}</FieldRow>
            <FieldRow inline label="Opportunity Nature">
              {canEdit ? (
                projectNatures.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No project natures configured. Add them in Settings.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {projectNatures.map((p) => {
                      const on = selectedNatures.includes(p.code)
                      return (
                        <button
                          key={p.code}
                          type="button"
                          onClick={() => toggleNature(p.code)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-muted-foreground hover:bg-accent"
                          )}
                        >
                          ({p.code}) - {p.name}
                        </button>
                      )
                    })}
                  </div>
                )
              ) : natureLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {natureLabels.map((l) => (
                    <Badge key={l} variant="outline">
                      {l}
                    </Badge>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </FieldRow>
            <FieldRow inline label="Opportunity Owner Contact">
              {canEdit ? (
                <InlineCombobox
                  value={o.ownerContactId ?? ""}
                  display={detail.ownerContact?.name ?? "—"}
                  options={contactOptions}
                  onSave={(next) => saveField({ ownerContactId: next || null })}
                  placeholder="Optional"
                  searchPlaceholder="Search contacts…"
                  emptyMessage="No contacts for this account."
                  title="Click to change owner contact"
                />
              ) : (
                detail.ownerContact?.name ?? "—"
              )}
              {detail.ownerContact?.designation ? (
                <span className="text-muted-foreground"> · {detail.ownerContact.designation}</span>
              ) : null}
            </FieldRow>
            <FieldRow inline label="Opportunity Owner Budget Limit">
              {canEdit ? (
                <InlineValue
                  value={o.ownerBudgetLimit ?? ""}
                  display={formatMoney(o.ownerBudgetLimit, o.currency)}
                  formatDraft={(v) => formatMoney(v || "0", o.currency)}
                  type="number"
                  title="Click to edit budget limit"
                  onSave={(next) => saveField({ ownerBudgetLimit: next || null })}
                />
              ) : (
                formatMoney(o.ownerBudgetLimit, o.currency)
              )}
            </FieldRow>
            <Separator />
            <FieldRow inline label="Total est. funnel amount">
              <span className="font-semibold tabular-nums">
                {formatMoney(o.totalEstimatedFunnelAmount, o.currency)}
              </span>
            </FieldRow>
            <FieldRow inline label="Funnels">
              <Badge variant="secondary" className="tabular-nums">
                {detail.funnels.length}
              </Badge>
            </FieldRow>
          </CardContent>
        </Card>

        <RelatedCard
          items={[
            { kind: "account", label: "Account", href: `/accounts/${detail.accountId}` },
            { kind: "funnel", label: "Funnels", count: detail.funnels.length, onSelect: () => setTab("funnels") },
            { kind: "quotation", label: "Quotations", count: detail.quotations.length, onSelect: () => setTab("quotations") },
            { kind: "product", label: "Products", count: detail.products.length, onSelect: () => setTab("products") },
          ]}
        />
      </DetailAside>

      {/* Right column — related lists (tabbed, like the funnel view) */}
      <DetailTabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="funnels">
                  Funnels
                  <Badge variant="secondary" className="ml-1.5 tabular-nums">
                    {detail.funnels.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="quotations">
                  Quotations
                  <Badge variant="secondary" className="ml-1.5 tabular-nums">
                    {detail.quotations.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="products">
                  Products
                  <Badge variant="secondary" className="ml-1.5 tabular-nums">
                    {detail.products.length}
                  </Badge>
                </TabsTrigger>
                <CountTab value="analysis">Analysis (PPVVC)</CountTab>
                <CountTab value="remarks">Remarks</CountTab>
                <TabsTrigger value="documents">
                  Documents
                  <Badge variant="secondary" className="ml-1.5 tabular-nums">
                    {documents.length}
                  </Badge>
                </TabsTrigger>
                <CountTab value="history">History</CountTab>
              </TabsList>

              <TabsContent value="funnels" className="mt-4">
                <DataTable
                  columns={funnelColumns}
                  data={detail.funnels}
                  tableId="opp-funnels"
                  searchColumn="name"
                  searchPlaceholder="Search funnels…"
                  toolbar={newFunnelButton}
                  emptyMessage="No funnels yet"
                  emptyDescription="Add a funnel under this opportunity to start the pipeline."
                />
              </TabsContent>

              <TabsContent value="quotations" className="mt-4">
                <DataTable
                  columns={quoteColumns}
                  data={detail.quotations}
                  tableId="opp-quotations"
                  searchColumn="quoteNumber"
                  searchPlaceholder="Search quotations…"
                  emptyMessage="No quotations yet"
                  emptyDescription="Quotations raised on this opportunity's funnels appear here."
                />
              </TabsContent>

              <TabsContent value="products" className="mt-4">
                <DataTable
                  columns={productColumns}
                  data={detail.products}
                  tableId="opp-products"
                  searchColumn="description"
                  searchPlaceholder="Search products…"
                  emptyMessage="No products yet"
                  emptyDescription="Opportunity products across this opportunity's funnels appear here."
                />
              </TabsContent>

              <TabsContent value="analysis" className="mt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Power Sponsor Contact
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineCombobox
                            value={o.powerSponsorContactId ?? ""}
                            display={detail.powerSponsorContact?.name ?? "—"}
                            options={contactOptions}
                            onSave={(next) => saveField({ powerSponsorContactId: next || null })}
                            placeholder="Optional"
                            searchPlaceholder="Search contacts…"
                            emptyMessage="No contacts for this account."
                            title="Click to change power sponsor"
                          />
                        ) : (
                          detail.powerSponsorContact?.name ?? "—"
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Power Sponsor Designation
                      </div>
                      <div className="text-sm">
                        {detail.powerSponsorContact?.designation || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Power Sponsor Budget Limit
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.powerSponsorBudgetLimit ?? ""}
                            display={formatMoney(o.powerSponsorBudgetLimit, o.currency)}
                            formatDraft={(v) => formatMoney(v || "0", o.currency)}
                            type="number"
                            title="Click to edit budget limit"
                            onSave={(next) => saveField({ powerSponsorBudgetLimit: next || null })}
                          />
                        ) : (
                          formatMoney(o.powerSponsorBudgetLimit, o.currency)
                        )}
                      </div>
                    </div>
                    {PPVVC.map((f) => (
                      <div key={f.key}>
                        <div className="text-xs font-medium text-muted-foreground">
                          {f.label}
                        </div>
                        <div className="text-sm">
                          {canEdit ? (
                            <InlineValue
                              value={o[f.key] ?? ""}
                              display={o[f.key] || "—"}
                              title={`Click to edit ${f.label}`}
                              onSave={(next) => saveField({ [f.key]: next || null })}
                            />
                          ) : (
                            o[f.key] || "—"
                          )}
                        </div>
                      </div>
                    ))}
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Estimated Budget
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.estimatedBudget ?? ""}
                            display={formatMoney(o.estimatedBudget, o.currency)}
                            formatDraft={(v) => formatMoney(v || "0", o.currency)}
                            type="number"
                            title="Click to edit estimated budget"
                            onSave={(next) => saveField({ estimatedBudget: next || null })}
                          />
                        ) : (
                          formatMoney(o.estimatedBudget, o.currency)
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Estimated Close Date
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.estimatedCloseDate ?? ""}
                            display={formatDate(o.estimatedCloseDate)}
                            formatDraft={(v) => (v ? formatDate(v) : "—")}
                            type="date"
                            title="Click to edit close date"
                            onSave={(next) => saveField({ estimatedCloseDate: next || null })}
                          />
                        ) : (
                          formatDate(o.estimatedCloseDate)
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Description
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.description ?? ""}
                            display={o.description || "Add description"}
                            title="Click to edit description"
                            onSave={(next) => saveField({ description: next || null })}
                          />
                        ) : (
                          o.description || "—"
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="remarks" className="mt-4">
                <Card>
                  <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Renewal Opportunity?
                      </div>
                      {canEdit ? (
                        <Switch
                          checked={o.isRenewal}
                          onCheckedChange={(v) => saveField({ isRenewal: v })}
                        />
                      ) : (
                        <div className="text-sm">{o.isRenewal ? "True" : "False"}</div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        Show Dashboards
                      </div>
                      {canEdit ? (
                        <Switch
                          checked={o.showDashboards}
                          onCheckedChange={(v) => saveField({ showDashboards: v })}
                        />
                      ) : (
                        <div className="text-sm">{o.showDashboards ? "True" : "False"}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Assigned Presales
                      </div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.assignedPresales ?? ""}
                            display={o.assignedPresales || "—"}
                            title="Click to edit assigned presales"
                            onSave={(next) => saveField({ assignedPresales: next || null })}
                          />
                        ) : (
                          o.assignedPresales || "—"
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Competitor</div>
                      <div className="text-sm">
                        {canEdit ? (
                          <InlineValue
                            value={o.competitor ?? ""}
                            display={o.competitor || "—"}
                            title="Click to edit competitor"
                            onSave={(next) => saveField({ competitor: next || null })}
                          />
                        ) : (
                          o.competitor || "—"
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="opportunity_container"
                  uploadId={o.id}
                  documents={documents}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                <ChangeHistory items={changes} />
              </TabsContent>
      </DetailTabs>
    </div>
  )
}
