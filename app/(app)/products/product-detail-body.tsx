"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { formatMoney } from "@/lib/format"
import type { ProductRow, ProductUsageRow } from "./actions"

// Status pill: rendered by the app-wide <StatusBadge> tone map.

/**
 * Salesperson-friendly product detail: a left column with the price and key
 * facts in plain language, and a right column with tabs for the full details
 * and the quotations this product appears in (top 5, searchable).
 */
export function ProductDetailBody({
  product,
  codeName,
  usage,
}: {
  product: ProductRow
  codeName: string | null
  usage: ProductUsageRow[]
}) {
  const [tab, setTab] = React.useState("details")

  // Distinct pipelines this product appears in (via its quotations).
  const pipelines = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usage) map.set(u.funnelId, u.funnelName)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [usage])

  const usageColumns = React.useMemo<ColumnDef<ProductUsageRow>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Quote" />,
        cell: ({ row }) => (
          <Link
            href={`/quotations/${row.original.quotationId}`}
            className="font-medium link"
          >
            {row.original.quoteNumber}
          </Link>
        ),
      },
      {
        accessorKey: "funnelName",
        header: "Funnel",
        cell: ({ row }) => (
          <Link
            href={`/funnel/${row.original.funnelId}`}
            className="link"
          >
            {row.original.funnelName}
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

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — the price + key facts, in plain language */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="product" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">Product</span>
              <CardTitle className="text-base">Price</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(product.standardPrice, product.currency)}
              </div>
              <div className="text-xs text-muted-foreground">
                {product.uom ? `per ${product.uom}` : "Standard price"} ·{" "}
                {product.currency}
              </div>
            </div>
            <div>
              {product.isActive ? (
                <Badge variant="secondary">Active — available to quote</Badge>
              ) : (
                <Badge variant="outline">Inactive — hidden from quotes</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Field label="Product line">
              {product.productCode ? (
                <span>
                  <span className="font-mono text-xs">{product.productCode}</span>
                  {codeName ? (
                    <span className="text-muted-foreground"> · {codeName}</span>
                  ) : null}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Subcategory">{product.subcategory ?? "—"}</Field>
            <Field label="Unit (UOM)">{product.uom ?? "—"}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Related</CardTitle>
          </CardHeader>
          <CardContent>
            <RelatedQuickLinks
              items={[
                {
                  kind: "quotation",
                  label: "Used in quotes",
                  count: usage.length,
                  onSelect: () => setTab("usage"),
                },
                {
                  kind: "funnel",
                  label: "Funnels",
                  count: pipelines.length,
                  onSelect: () => setTab("usage"),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Right column — tabbed full details */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="min-h-[26rem] pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="usage">
                  Used in quotes
                  <Badge variant="secondary" className="ml-1.5">
                    {usage.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-4 grid gap-6">
                <section>
                  <h3 className="mb-3 text-sm font-semibold">
                    Product information
                  </h3>
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <Field label="Product name">{product.name}</Field>
                    <Field label="Unit (UOM)">{product.uom ?? "—"}</Field>
                    <Field label="Product line">
                      {product.productCode ? (
                        <span>
                          <span className="font-mono text-xs">
                            {product.productCode}
                          </span>
                          {codeName ? (
                            <span className="text-muted-foreground">
                              {" "}· {codeName}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Field>
                    <Field label="Currency">{product.currency}</Field>
                    <Field label="Subcategory">
                      {product.subcategory ?? "—"}
                    </Field>
                    <Field label="Standard price">
                      {formatMoney(product.standardPrice, product.currency)}
                    </Field>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold">Description</h3>
                  {product.description ? (
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {product.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No description added.
                    </p>
                  )}
                </section>
              </TabsContent>

              <TabsContent value="usage" className="mt-4">
                <DataTable
                  columns={usageColumns}
                  data={usage}
                  tableId="product-usage"
                  searchColumn="quoteNumber"
                  searchPlaceholder="Search quotes…"
                  emptyMessage="This product isn't on any quotes yet."
                  pageSize={5}
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
