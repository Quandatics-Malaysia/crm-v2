"use client"

import * as React from "react"
import { Briefcase } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader, linkCell } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/format"
import type { OpportunityContainerRow } from "./actions"

export function OpportunitiesTable({ data }: { data: OpportunityContainerRow[] }) {
  const columns = React.useMemo<ColumnDef<OpportunityContainerRow>[]>(
    // Opportunity name and code are identical system-generated values, so the
    // list renders one identifier column instead of duplicating it.
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Opportunity" />,
        cell: linkCell(
          (r) => `/opportunities/${r.id}`,
          (r) => r.name
        ),
      },
      {
        accessorKey: "accountName",
        header: ({ column }) => <SortableHeader column={column} title="Account" />,
        cell: ({ row }) => row.original.accountName ?? "—",
      },
      {
        accessorKey: "totalEstimatedFunnelAmount",
        header: ({ column }) => (
          <SortableHeader column={column} title="Total est. funnel amount" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.totalEstimatedFunnelAmount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "funnelCount",
        header: ({ column }) => <SortableHeader column={column} title="Funnels" />,
        cell: ({ row }) => (
          <Badge variant="secondary" className="tabular-nums">
            {row.original.funnelCount}
          </Badge>
        ),
      },
      {
        accessorKey: "ownerName",
        header: "Owner",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.ownerName ?? "—"}</span>
        ),
      },
    ],
    []
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="opportunities"
      cap={2000}
      searchColumn="name"
      searchPlaceholder="Search opportunities…"
      emptyIcon={Briefcase}
      emptyMessage="No opportunities yet"
      emptyDescription="An opportunity is created automatically when you add a funnel or convert a lead."
    />
  )
}
