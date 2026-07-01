"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatMoney } from "@/lib/format"
import { StageBadge } from "./stage-badge"
import type { OpportunityListRow } from "./actions"

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "secondary",
  won: "default",
  lost: "destructive",
  on_hold: "outline",
}

const columns: ColumnDef<OpportunityListRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <Link
        href={`/funnel/${row.original.id}`}
        className="font-medium link"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "accountName",
    header: ({ column }) => <SortableHeader column={column} title="Account" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.accountName}</span>
    ),
  },
  {
    accessorKey: "stageName",
    id: "stageName",
    header: "Stage",
    cell: ({ row }) => (
      <StageBadge
        name={row.original.stageName}
        kind={row.original.stageKind}
        probability={row.original.stageProbability}
      />
    ),
  },
  {
    id: "amount",
    accessorFn: (row) => Number(row.estimatedAmount ?? row.amount ?? 0),
    header: ({ column }) => <SortableHeader column={column} title="Est. amount" />,
    cell: ({ row }) => {
      const value = row.original.estimatedAmount ?? row.original.amount
      return (
        <span className="tabular-nums">
          {value ? formatMoney(value, row.original.currency) : "—"}
        </span>
      )
    },
    sortingFn: (a, b) =>
      Number(a.original.estimatedAmount ?? a.original.amount ?? 0) -
      Number(b.original.estimatedAmount ?? b.original.amount ?? 0),
  },
  {
    id: "ownerName",
    accessorFn: (row) => row.ownerName ?? "Unassigned",
    header: "Owner",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.ownerName ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "expectedCloseDate",
    header: ({ column }) => (
      <SortableHeader column={column} title="Expected close" />
    ),
    cell: ({ row }) => formatDate(row.original.expectedCloseDate),
  },
  {
    accessorKey: "status",
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={statusVariant[row.original.status] ?? "secondary"}
        className="capitalize"
      >
        {row.original.status.replace(/_/g, " ")}
      </Badge>
    ),
  },
]

export function OpportunitiesTable({
  data,
  toolbar,
}: {
  data: OpportunityListRow[]
  toolbar?: React.ReactNode
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchColumn="name"
      searchPlaceholder="Search funnels…"
      emptyMessage="No funnels yet."
      toolbar={toolbar}
      tableId="funnel"
      cap={1000}
      facets={[
        { columnId: "stageName", title: "Stage" },
        { columnId: "status", title: "Status" },
        { columnId: "ownerName", title: "Owner" },
      ]}
    />
  )
}
