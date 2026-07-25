"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"

import type { AuditRow } from "./actions"

const RECORD_LABEL: Record<string, string> = {
  opportunity: "Funnel",
  stage_approval_request: "Approval",
  person: "Contact",
  account: "Account",
  lead: "Lead",
  quotation: "Quotation",
  project: "Project",
  quotation_line_item: "Quotation",
  tax_setting: "Tax",
}

function recordLabel(entityType: string): string {
  return (
    RECORD_LABEL[entityType] ??
    entityType.charAt(0).toUpperCase() + entityType.slice(1)
  )
}

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
        id: "record",
        accessorFn: (row) => recordLabel(row.entityType),
        header: ({ column }) => <SortableHeader column={column} title="Record" />,
        cell: ({ getValue }) => (
          <Badge variant="outline" className="font-normal">
            {getValue<string>()}
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
        { columnId: "record", title: "Record" },
      ]}
      tableId="audit"
    />
  )
}
