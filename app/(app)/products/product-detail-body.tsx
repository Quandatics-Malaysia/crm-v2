"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, SortableHeader } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { ObjectTile, RelatedQuickLinks } from "@/components/object-tile"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { showActionError } from "@/lib/show-action-error"
import { formatMoney } from "@/lib/format"
import {
  updateProduct,
  type ProductInput,
  type ProductRow,
  type ProductUsageRow,
  type ProductDealRow,
} from "./actions"

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
  deals,
  productCodes,
  canEdit,
}: {
  product: ProductRow
  codeName: string | null
  usage: ProductUsageRow[]
  deals: ProductDealRow[]
  /** Product-line picker options for the inline category combobox. */
  productCodes: { code: string; name: string }[]
  /** Gates every inline editor (PRODUCT_UPDATE, resolved server-side). */
  canEdit: boolean
}) {
  const [tab, setTab] = React.useState("details")
  const router = useRouter()

  async function saveField(patch: Partial<ProductInput>) {
    // updateProduct is full-replace; the product row carries every input field.
    const res = await updateProduct(product.id, { ...product, ...patch })
    if (!res.ok) {
      showActionError(res)
      return
    }
    router.refresh()
  }

  const codeOptions = React.useMemo(
    () => productCodes.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
    [productCodes]
  )

  const dealColumns = React.useMemo<ColumnDef<ProductDealRow>[]>(
    () => [
      {
        accessorKey: "opportunityName",
        header: ({ column }) => <SortableHeader column={column} title="Opportunity" />,
        cell: ({ row }) =>
          row.original.opportunityId ? (
            <Link
              href={`/opportunities/${row.original.opportunityId}`}
              className="font-medium link"
            >
              {row.original.opportunityName ?? "—"}
            </Link>
          ) : (
            "—"
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
            {formatMoney(row.original.unitPrice, row.original.currency)}
          </div>
        ),
      },
    ],
    []
  )

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
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
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
              {canEdit ? (
                <InlineValue
                  value={product.standardPrice}
                  display={
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatMoney(product.standardPrice, product.currency)}
                    </span>
                  }
                  formatDraft={(v) => (
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatMoney(v || "0", product.currency)}
                    </span>
                  )}
                  type="number"
                  title="Click to edit standard price"
                  onSave={(next) => saveField({ standardPrice: next || null })}
                />
              ) : (
                <div className="text-2xl font-semibold tabular-nums">
                  {formatMoney(product.standardPrice, product.currency)}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {product.uom ? `per ${product.uom}` : "Standard price"} ·{" "}
                {product.currency}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <Switch
                  checked={product.isActive}
                  onCheckedChange={(v) => saveField({ isActive: v })}
                  aria-label="Active"
                />
              ) : null}
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
              {canEdit ? (
                <InlineCombobox
                  value={product.productCode ?? ""}
                  display={
                    product.productCode ? (
                      <span>
                        <span className="font-mono text-xs">{product.productCode}</span>
                        {codeName ? (
                          <span className="text-muted-foreground"> · {codeName}</span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                  options={codeOptions}
                  onSave={(next) => saveField({ productCode: next || null })}
                  searchPlaceholder="Search product lines…"
                  emptyMessage="No product lines configured."
                  title="Click to change product line"
                />
              ) : product.productCode ? (
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
                <TabsTrigger value="deals">
                  On opportunities
                  <Badge variant="secondary" className="ml-1.5">
                    {deals.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-4 grid gap-6">
                {/* Salesforce "Product Information" section — field order mirrors
                    the reference: Name / Category / Subcategory · UOM / Currency /
                    Active. */}
                <section>
                  <h3 className="mb-3 text-sm font-semibold">
                    Product Information
                  </h3>
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <Field label="Product name">
                      {canEdit ? (
                        <InlineValue
                          value={product.name}
                          display={product.name}
                          title="Click to edit name"
                          onSave={(next) => {
                            if (!next.trim()) return
                            return saveField({ name: next })
                          }}
                        />
                      ) : (
                        product.name
                      )}
                    </Field>
                    <Field label="Unit (UOM)">{product.uom ?? "—"}</Field>
                    <Field label="Product category">
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
                    <Field label="Product subcategory">
                      {product.subcategory ?? "—"}
                    </Field>
                    <Field label="Active">
                      {product.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </Field>
                    <Field label="Standard price">
                      {formatMoney(product.standardPrice, product.currency)}
                    </Field>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold">
                    Description Information
                  </h3>
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

              <TabsContent value="deals" className="mt-4">
                <DataTable
                  columns={dealColumns}
                  data={deals}
                  tableId="product-deals"
                  searchColumn="opportunityName"
                  searchPlaceholder="Search opportunities…"
                  emptyMessage="This product isn't on any opportunities yet."
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
