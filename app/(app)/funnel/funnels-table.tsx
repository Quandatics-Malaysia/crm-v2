"use client"

import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader, linkCell } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { formatDate, formatMoney } from "@/lib/format"
import { StageBadge } from "./stage-badge"
import type { OpportunityListRow } from "./actions"

const columns: ColumnDef<OpportunityListRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Name" />,
    cell: linkCell(
      (r) => `/funnel/${r.id}`,
      (r) => r.name
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
    id: "amount",
    accessorFn: (row) => Number(row.estimatedAmount ?? row.amount ?? 0),
    header: ({ column }) => (
      <SortableHeader column={column} title="Est. funnel amount" />
    ),
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
    accessorKey: "expectedCloseDate",
    header: ({ column }) => (
      <SortableHeader column={column} title="Est. close date" />
    ),
    cell: ({ row }) => formatDate(row.original.expectedCloseDate),
  },
  {
    accessorKey: "stageName",
    id: "stageName",
    header: "Sales stage",
    cell: ({ row }) => (
      <StageBadge
        name={row.original.stageName}
        kind={row.original.stageKind}
        probability={row.original.stageProbability}
      />
    ),
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
    accessorKey: "status",
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
      searchPlaceholder="Search pipelines…"
      emptyMessage="No pipelines yet."
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
