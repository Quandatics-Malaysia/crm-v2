"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { DataTable, SortableHeader } from "@/components/data-table"
import { formatMoney } from "@/lib/format"
import type { OpportunityContainerDetail } from "../actions"

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function stageVariant(kind: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (kind === "WON") return "default"
  if (kind === "LOST") return "destructive"
  if (kind === "PARKED") return "outline"
  return "secondary"
}

export function OpportunityDetailBody({
  detail,
}: {
  detail: OpportunityContainerDetail
}) {
  const [tab, setTab] = React.useState("funnels")
  const o = detail.opportunity

  const funnelColumns = React.useMemo<ColumnDef<FunnelRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Funnel" />,
        cell: ({ row }) => (
          <Link href={`/funnel/${row.original.id}`} className="font-medium link">
            {row.original.name}
          </Link>
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
        cell: ({ row }) => (
          <Link href={`/quotations/${row.original.id}`} className="font-medium link">
            {row.original.quoteNumber}
          </Link>
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
        header: () => <div className="text-right">Qty</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{Number(row.original.quantity)}</div>
        ),
      },
      {
        accessorKey: "unitPrice",
        header: () => <div className="text-right">Unit price</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatMoney(row.original.unitPrice, o.currency)}
          </div>
        ),
      },
    ],
    [o.currency]
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — opportunity highlights */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="opportunity" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Opportunity</span>
              <CardTitle className="text-base">Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Field label="Code">
              <span className="font-mono text-xs">{o.code}</span>
            </Field>
            <Field label="Account">
              <Link href={`/accounts/${detail.accountId}`} className="font-medium link">
                {detail.accountName}
              </Link>
            </Field>
            <Field label="Owner">{detail.ownerName ?? "—"}</Field>
            <Separator />
            <Field label="Total est. funnel amount">
              <span className="font-semibold tabular-nums">
                {formatMoney(o.totalEstimatedFunnelAmount, o.currency)}
              </span>
            </Field>
            <Field label="Funnels">
              <Badge variant="secondary" className="tabular-nums">
                {detail.funnels.length}
              </Badge>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                { kind: "account", label: "Account", href: `/accounts/${detail.accountId}` },
                { kind: "funnel", label: "Funnels", count: detail.funnels.length, onSelect: () => setTab("funnels") },
                { kind: "quotation", label: "Quotations", count: detail.quotations.length, onSelect: () => setTab("quotations") },
                { kind: "product", label: "Products", count: detail.products.length, onSelect: () => setTab("products") },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right column — related lists (tabbed, like the funnel view) */}
      <div className="lg:col-span-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap justify-start gap-1 *:flex-none">
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
            <TabsTrigger value="analysis">Analysis (PPVVC)</TabsTrigger>
          </TabsList>

          <TabsContent value="funnels" className="mt-4">
            <DataTable
              columns={funnelColumns}
              data={detail.funnels}
              tableId="opp-funnels"
              searchColumn="name"
              searchPlaceholder="Search funnels…"
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
                {PPVVC.map((f) => (
                  <div key={f.key}>
                    <div className="text-xs font-medium text-muted-foreground">
                      {f.label}
                    </div>
                    <div className="text-sm">{o[f.key] || "—"}</div>
                  </div>
                ))}
                {o.description ? (
                  <div className="sm:col-span-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Description
                    </div>
                    <div className="text-sm">{o.description}</div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
