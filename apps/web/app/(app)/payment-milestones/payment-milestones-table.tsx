"use client"

import * as React from "react"
import Link from "next/link"
import { CreditCard } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { ObjectTile } from "@/components/object-tile"
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
          <div className="flex items-center gap-2.5">
            <ObjectTile kind="milestone" className="size-7" iconClassName="size-4" />
            <Link
              href={`/payment-milestones/${row.original.id}`}
              className="font-medium link"
            >
              {row.original.title}
            </Link>
          </div>
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
      facets={[{ columnId: "status", title: "Status" }]}
      searchColumn="title"
      searchPlaceholder="Search payment milestones…"
      emptyIcon={CreditCard}
      emptyMessage="No payment milestones yet"
      emptyDescription="Payment milestones attached to funnels appear here."
    />
  )
}
