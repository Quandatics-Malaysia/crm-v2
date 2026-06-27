"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { formatMoney, formatDate } from "@/lib/format"
import { createQuotation, type QuotationListItem } from "./actions"

const STATUS_VARIANT: Record<
  QuotationListItem["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  sent: "secondary",
  accepted: "default",
  rejected: "destructive",
  expired: "outline",
  void: "outline",
}

function NewQuotationDialog({
  opportunities,
}: {
  opportunities: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [opportunityId, setOpportunityId] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  async function onCreate() {
    if (!opportunityId) {
      toast.error("Select a funnel")
      return
    }
    setCreating(true)
    const res = await createQuotation({
      opportunityId,
      taxSettingId: null,
      validUntil: null,
      notes: null,
      lines: [],
    })
    if (!res.ok) {
      toast.error(res.error)
      setCreating(false)
      return
    }
    toast.success("Quotation created")
    setOpen(false)
    router.push(`/quotations/${res.data.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New quotation</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Funnel</Label>
          <Select
            value={opportunityId}
            onValueChange={(v) => setOpportunityId(v ?? "")}
            items={opportunities.map((o) => ({ value: o.id, label: o.name }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a funnel…" />
            </SelectTrigger>
            <SelectContent>
              {opportunities.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={onCreate} disabled={creating}>
            {creating ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function QuotationsTable({
  data,
  opportunities,
}: {
  data: QuotationListItem[]
  opportunities: { id: string; name: string }[]
}) {
  const columns: ColumnDef<QuotationListItem>[] = [
    {
      accessorKey: "quoteNumber",
      header: ({ column }) => <SortableHeader column={column} title="Number" />,
      cell: ({ row }) => (
        <Link
          href={`/quotations/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.quoteNumber}
        </Link>
      ),
    },
    {
      accessorKey: "opportunityName",
      header: ({ column }) => (
        <SortableHeader column={column} title="Funnel" />
      ),
      cell: ({ row }) => row.original.opportunityName ?? "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]} className="capitalize">
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "total",
      header: ({ column }) => <SortableHeader column={column} title="Total" />,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.total, row.original.currency)}
        </span>
      ),
    },
    {
      id: "primary",
      header: "Primary",
      cell: ({ row }) =>
        row.original.isPrimary ? <Badge variant="secondary">Primary</Badge> : null,
    },
    {
      accessorKey: "validUntil",
      header: "Valid until",
      cell: ({ row }) => formatDate(row.original.validUntil),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="quotations"
      facets={[{ columnId: "status", title: "Status" }]}
      searchColumn="quoteNumber"
      searchPlaceholder="Search by number…"
      emptyMessage="No quotations yet."
      toolbar={<NewQuotationDialog opportunities={opportunities} />}
    />
  )
}
