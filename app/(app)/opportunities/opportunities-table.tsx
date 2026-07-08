"use client"

import * as React from "react"
import Link from "next/link"
import { Briefcase } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/format"
import type { OpportunityContainerRow } from "./actions"

export function OpportunitiesTable({ data }: { data: OpportunityContainerRow[] }) {
  const columns = React.useMemo<ColumnDef<OpportunityContainerRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <SortableHeader column={column} title="Code" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Opportunity" />,
        cell: ({ row }) => (
          <Link href={`/opportunities/${row.original.id}`} className="font-medium link">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "accountName",
        header: ({ column }) => <SortableHeader column={column} title="Account" />,
        cell: ({ row }) => row.original.accountName ?? "—",
      },
      {
        accessorKey: "ownerName",
        header: "Owner",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.ownerName ?? "—"}</span>
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
        accessorKey: "totalEstimatedFunnelAmount",
        header: ({ column }) => (
          <SortableHeader column={column} title="Est. funnel amount" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.totalEstimatedFunnelAmount, row.original.currency)}
          </span>
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
