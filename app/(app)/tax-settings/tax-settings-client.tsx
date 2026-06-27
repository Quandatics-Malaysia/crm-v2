"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { MoreHorizontal } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { formatPercent } from "@/lib/format"
import {
  createTax,
  updateTax,
  deleteTax,
  setDefaultTax,
  type TaxInput,
  type TaxSettingRow,
} from "./actions"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  ratePercent: z
    .string()
    .trim()
    .min(1, "Rate is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Enter a valid rate"),
  isDefault: z.boolean(),
  isActive: z.boolean(),
})

type FormValues = z.infer<typeof schema>

function TaxDialog({
  open,
  onOpenChange,
  initial,
  trigger,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: TaxSettingRow
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      ratePercent: initial?.ratePercent ?? "0",
      isDefault: initial?.isDefault ?? false,
      isActive: initial?.isActive ?? true,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: initial?.name ?? "",
        ratePercent: initial?.ratePercent ?? "0",
        isDefault: initial?.isDefault ?? false,
        isActive: initial?.isActive ?? true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onSubmit(values: FormValues) {
    setSaving(true)
    const payload: TaxInput = {
      name: values.name,
      ratePercent: values.ratePercent,
      isDefault: values.isDefault,
      isActive: values.isActive,
    }
    const res = initial
      ? await updateTax(initial.id, payload)
      : await createTax(payload)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(initial ? "Tax setting updated" : "Tax setting created")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit tax setting" : "New tax setting"}</DialogTitle>
          <DialogDescription>
            Configure a tax rate applied to quotations.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. SST 6%" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ratePercent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate (%)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.001" min="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4">
                  <div className="grid gap-1">
                    <FormLabel>Default tax</FormLabel>
                    <FormDescription>
                      Pre-selected on new quotation lines. Exactly one tax is the
                      default — turning this on moves the default off the current
                      one.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4">
                  <div className="grid gap-1">
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive rates are hidden from new quotations but kept for
                      history. The default tax must stay active. Whether prices
                      include tax is set by “Tax-inclusive pricing” in Settings →
                      General.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : initial ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function RowActions({ row }: { row: TaxSettingRow }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)

  async function onDelete() {
    const res = await deleteTax(row.id)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Tax setting deleted")
    router.refresh()
  }

  async function onSetDefault() {
    const res = await setDefaultTax(row.id)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Default tax updated")
    router.refresh()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal />
              <span className="sr-only">Actions</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          {!row.isDefault ? (
            <DropdownMenuItem onClick={onSetDefault}>Make default</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaxDialog open={editOpen} onOpenChange={setEditOpen} initial={row} />
    </>
  )
}

export function TaxSettingsClient({ data }: { data: TaxSettingRow[] }) {
  const [createOpen, setCreateOpen] = React.useState(false)

  const columns: ColumnDef<TaxSettingRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortableHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "ratePercent",
      header: ({ column }) => <SortableHeader column={column} title="Rate" />,
      cell: ({ row }) => formatPercent(row.original.ratePercent),
    },
    {
      id: "default",
      header: "Default",
      cell: ({ row }) =>
        row.original.isDefault ? <Badge>Default</Badge> : null,
    },
    {
      id: "active",
      header: "Active",
      cell: ({ row }) =>
        row.original.isActive ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => <RowActions row={row.original} />,
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchColumn="name"
        searchPlaceholder="Search tax settings…"
        emptyMessage="No tax settings yet."
        toolbar={
          <TaxDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            trigger={
              <DialogTrigger render={<Button size="sm">New tax setting</Button>} />
            }
          />
        }
      />
    </>
  )
}
