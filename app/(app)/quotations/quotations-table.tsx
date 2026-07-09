"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/status-badge"
import { Plus } from "lucide-react"
import { formatMoney, formatDate } from "@/lib/format"
import type { QuotationListItem } from "./actions"

export function QuotationsTable({
  data,
  canCreate,
}: {
  data: QuotationListItem[]
  canCreate: boolean
}) {
  const columns: ColumnDef<QuotationListItem>[] = [
    {
      accessorKey: "quoteNumber",
      header: ({ column }) => <SortableHeader column={column} title="Number" />,
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
      accessorKey: "opportunityName",
      header: ({ column }) => (
        <SortableHeader column={column} title="Funnel" />
      ),
      cell: ({ row }) => row.original.opportunityName ?? "—",
    },
    // Salesforce Quote list surfaces the Total Excluding Tax / Tax Amount /
    // Total Including Tax trio; we mirror it with the columns we already store
    // (subtotal / taxTotal / total). Ref No, Synced and Line-item count have no
    // column in our schema, so they're omitted (no schema changes).
    {
      accessorKey: "subtotal",
      header: ({ column }) => (
        <SortableHeader column={column} title="Total excl. tax" />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.subtotal, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "taxTotal",
      header: ({ column }) => <SortableHeader column={column} title="Tax amount" />,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.taxTotal, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "total",
      header: ({ column }) => (
        <SortableHeader column={column} title="Total incl. tax" />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.total, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} className="capitalize" />
      ),
    },
    {
      id: "primary",
      header: "Primary",
      cell: ({ row }) =>
        row.original.isPrimary ? <Badge variant="secondary">Primary</Badge> : null,
    },
    {
      accessorKey: "validUntil",
      header: "Valid until",
      cell: ({ row }) => formatDate(row.original.validUntil),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="quotations"
      cap={500}
      facets={[{ columnId: "status", title: "Status" }]}
      searchColumn="quoteNumber"
      searchPlaceholder="Search by number…"
      emptyMessage="No quotations yet."
      toolbar={
        canCreate ? (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/quotations/new" />}
          >
            <Plus className="size-4" />
            New quotation
          </Button>
        ) : undefined
      }
    />
  )
}
