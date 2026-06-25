"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"

import type { AuditRow } from "./actions"

export function AuditTable({ data }: { data: AuditRow[] }) {
  const columns = React.useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "action",
        header: ({ column }) => <SortableHeader column={column} title="Action" />,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.action}</span>
        ),
      },
      {
        accessorKey: "entityType",
        header: ({ column }) => <SortableHeader column={column} title="Entity" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-normal">
            {row.original.entityType}
          </Badge>
        ),
      },
      {
        id: "entityId",
        accessorKey: "entityId",
        header: "Entity ID",
        cell: ({ row }) => (
          <span className="block max-w-[12rem] truncate font-mono text-xs text-muted-foreground">
            {row.original.entityId}
          </span>
        ),
      },
      {
        id: "actor",
        accessorKey: "actorName",
        header: ({ column }) => <SortableHeader column={column} title="Actor" />,
        cell: ({ row }) => (
          <span>{row.original.actorName ?? "System"}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader column={column} title="When" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.createdAt)}
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
      searchColumn="action"
      searchPlaceholder="Search by action…"
      emptyMessage="No audit events yet."
      facets={[
        { columnId: "action", title: "Action" },
        { columnId: "entityType", title: "Entity" },
      ]}
      tableId="audit"
    />
  )
}
