"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/format"
import type { ProjectListItem } from "./actions"

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  planning: "outline",
  active: "default",
  on_hold: "secondary",
  completed: "secondary",
  cancelled: "destructive",
}

const columns: ColumnDef<ProjectListItem>[] = [
  {
    accessorKey: "projectCode",
    header: ({ column }) => <SortableHeader column={column} title="Code" />,
    cell: ({ row }) => (
      <Link
        href={`/projects/${row.original.id}`}
        className="font-mono text-sm font-medium hover:underline"
      >
        {row.original.projectCode}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <Link
        href={`/projects/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "accountName",
    header: ({ column }) => <SortableHeader column={column} title="Account" />,
    cell: ({ row }) =>
      row.original.accountName ? (
        <Link
          href={`/accounts/${row.original.accountId}`}
          className="text-muted-foreground hover:underline"
        >
          {row.original.accountName}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "status",
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
  {
    accessorKey: "value",
    header: ({ column }) => <SortableHeader column={column} title="Value" />,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.value
          ? formatMoney(row.original.value, row.original.currency)
          : "—"}
      </span>
    ),
    sortingFn: (a, b) =>
      Number(a.original.value ?? 0) - Number(b.original.value ?? 0),
  },
  {
    accessorKey: "opportunityName",
    header: "Funnel",
    cell: ({ row }) =>
      row.original.opportunityId ? (
        <Link
          href={`/funnel/${row.original.opportunityId}`}
          className="text-muted-foreground hover:underline"
        >
          {row.original.opportunityName ?? "View funnel"}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export function ProjectsTable({
  data,
  toolbar,
}: {
  data: ProjectListItem[]
  toolbar?: React.ReactNode
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchColumn="name"
      searchPlaceholder="Search projects…"
      emptyMessage="No projects yet."
      facets={[{ columnId: "status", title: "Status" }]}
      tableId="projects"
      toolbar={toolbar}
    />
  )
}
