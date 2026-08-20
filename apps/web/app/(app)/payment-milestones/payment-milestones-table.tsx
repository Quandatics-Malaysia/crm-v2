"use client"

import * as React from "react"
import Link from "next/link"
import { CreditCard } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { formatMoney } from "@/lib/format"
import type { PaymentMilestoneListItem } from "./actions"

export function PaymentMilestonesTable({
  data,
}: {
  data: PaymentMilestoneListItem[]
}) {
  const columns = React.useMemo<ColumnDef<PaymentMilestoneListItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => (
          <SortableHeader column={column} title="Payment Milestone Name" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/payment-milestones/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <SortableHeader column={column} title="Amount" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: "quoteNumber",
        header: "Quotation",
        cell: ({ row }) =>
          row.original.quotationId && row.original.quoteNumber ? (
            <Link href={`/quotations/${row.original.quotationId}`} className="link">
              <span className="font-mono text-xs">{row.original.quoteNumber}</span>
            </Link>
          ) : (
            <span className="text-muted-foreground">Not linked</span>
          ),
      },
      {
        accessorKey: "quoteStatus",
        header: "Quote status",
        cell: ({ row }) =>
          row.original.quoteStatus ? (
            <StatusBadge status={row.original.quoteStatus} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "funnelName",
        header: "Funnel",
        cell: ({ row }) =>
          row.original.funnelId && row.original.funnelName ? (
            <Link href={`/funnel/${row.original.funnelId}`} className="link">
              {row.original.funnelName}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    []
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="payment-milestones"
      cap={1000}
      filters={[{
        type: "enum",
        columnId: "status",
        title: "Status",
        options: Array.from(new Set(data.map((row) => row.status).filter(Boolean))).map((value) => ({ value, label: value })),
      }]}
      searchColumn="title"
      searchPlaceholder="Search payment milestones…"
      emptyIcon={CreditCard}
      emptyMessage="No payment milestones yet"
      emptyDescription="Payment milestones attached to funnels appear here."
    />
  )
}
