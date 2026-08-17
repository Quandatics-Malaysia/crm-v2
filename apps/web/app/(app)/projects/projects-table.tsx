"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader, linkCell } from "@/components/data-table"
import { StatusBadge } from "@/components/status-badge"
import { formatMoney } from "@/lib/format"
import type { ProjectListItem } from "./actions"

const columns: ColumnDef<ProjectListItem>[] = [
  {
    accessorKey: "projectCode",
    header: ({ column }) => <SortableHeader column={column} title="Code" />,
    cell: ({ row }) => (
      <Link
        href={`/projects/${row.original.id}`}
        className="font-mono text-sm font-medium link"
      >
        {row.original.projectCode}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Name" />,
    cell: linkCell(
      (r) => `/projects/${r.id}`,
      (r) => r.name
    ),
  },
  {
    accessorKey: "accountName",
    header: ({ column }) => <SortableHeader column={column} title="Account" />,
    cell: ({ row }) =>
      row.original.accountName ? (
        <Link
          href={`/accounts/${row.original.accountId}`}
          className="link"
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
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
      row.original.funnelId ? (
        <Link
          href={`/funnel/${row.original.funnelId}`}
          className="link"
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
      filters={[{
        type: "enum",
        columnId: "status",
        title: "Status",
        options: Array.from(new Set(data.map((row) => row.status).filter(Boolean))).map((value) => ({ value, label: value })),
      }]}
      tableId="projects"
      cap={1000}
      toolbar={toolbar}
    />
  )
}
