"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { TabsContent, TabsList } from "@/components/ui/tabs"
import {
  DataTable,
  SortableHeader,
  rightHeader,
  moneyCell,
  linkCell,
} from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import {
  DetailAside,
  DetailCardHeader,
  DetailTabs,
  RelatedCard,
  CountTab,
  FieldRow,
  FieldSection,
  useSaveField,
} from "@/components/detail-page"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
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

  // updateProduct is full-replace; the product row carries every input field.
  const saveField = useSaveField((patch: Partial<ProductInput>) =>
    updateProduct(product.id, { ...product, ...patch })
  )

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
        header: rightHeader("Qty"),
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{Number(row.original.quantity)}</div>
        ),
      },
      {
        accessorKey: "unitPrice",
        header: rightHeader("Unit price"),
        cell: moneyCell<ProductDealRow>(
          (r) => r.unitPrice,
          (r) => r.currency
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
        cell: linkCell<ProductUsageRow>(
          (r) => `/quotations/${r.quotationId}`,
          (r) => r.quoteNumber
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
        header: rightHeader("Total"),
        cell: moneyCell<ProductUsageRow>(
          (r) => r.total,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — the price + key facts, in plain language */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="product" eyebrow="Product" title="Price" />
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
            <FieldRow label="Product line">
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
            </FieldRow>
            <FieldRow label="Subcategory">
              {canEdit ? (
                <InlineValue
                  value={product.subcategory ?? ""}
                  display={product.subcategory || "—"}
                  title="Click to edit subcategory"
                  onSave={(next) => saveField({ subcategory: next || null })}
                />
              ) : (
                (product.subcategory ?? "—")
              )}
            </FieldRow>
            <FieldRow label="Unit (UOM)">
              {canEdit ? (
                <InlineValue
                  value={product.uom ?? ""}
                  display={product.uom || "—"}
                  title="Click to edit unit"
                  onSave={(next) => saveField({ uom: next || null })}
                />
              ) : (
                (product.uom ?? "—")
              )}
            </FieldRow>
          </CardContent>
        </Card>

        <RelatedCard
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
      </DetailAside>

      {/* Right column — tabbed full details */}
      <DetailTabs value={tab} onValueChange={setTab}>
        <TabsList>
          <CountTab value="details">Details</CountTab>
          <CountTab value="usage" count={usage.length}>
            Used in quotes
          </CountTab>
          <CountTab value="deals" count={deals.length}>
            On opportunities
          </CountTab>
        </TabsList>

        <TabsContent value="details" className="mt-4 grid gap-6">
          {/* Salesforce "Product Information" section — field order mirrors
              the reference: Name / Category / Subcategory · UOM / Currency /
              Active. */}
          <FieldSection title="Product Information">
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <FieldRow label="Product name">
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
              </FieldRow>
              <FieldRow label="Unit (UOM)">
                {canEdit ? (
                  <InlineValue
                    value={product.uom ?? ""}
                    display={product.uom || "—"}
                    title="Click to edit unit"
                    onSave={(next) => saveField({ uom: next || null })}
                  />
                ) : (
                  (product.uom ?? "—")
                )}
              </FieldRow>
              <FieldRow label="Product category">
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
              </FieldRow>
              <FieldRow label="Currency">{product.currency}</FieldRow>
              <FieldRow label="Product subcategory">
                {canEdit ? (
                  <InlineValue
                    value={product.subcategory ?? ""}
                    display={product.subcategory || "—"}
                    title="Click to edit subcategory"
                    onSave={(next) => saveField({ subcategory: next || null })}
                  />
                ) : (
                  (product.subcategory ?? "—")
                )}
              </FieldRow>
              <FieldRow label="Active">
                {product.isActive ? (
                  <Badge variant="secondary">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </FieldRow>
              <FieldRow label="Standard price">
                {formatMoney(product.standardPrice, product.currency)}
              </FieldRow>
            </div>
          </FieldSection>

          <FieldSection title="Description Information">
            {canEdit ? (
              <InlineValue
                value={product.description ?? ""}
                multiline
                display={
                  <span
                    className={cn(
                      "text-sm whitespace-pre-wrap text-muted-foreground",
                      !product.description && "italic"
                    )}
                  >
                    {product.description || "No description added."}
                  </span>
                }
                title="Click to edit description"
                onSave={(next) => saveField({ description: next || null })}
              />
            ) : product.description ? (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {product.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description added.
              </p>
            )}
          </FieldSection>
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
      </DetailTabs>
    </div>
  )
}
