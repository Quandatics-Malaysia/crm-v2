"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatDate } from "@/lib/format"
import type { Option } from "@/lib/lookups"
import { AccountForm } from "./account-form"
import { deleteAccount, type AccountListItem } from "./actions"

function RowActions({
  account,
  parentOptions,
  industries,
}: {
  account: AccountListItem
  parentOptions: Option[]
  industries: string[]
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  // Exclude self from parent + end-user options (no self-parenting / self-end-user).
  const editOptions = React.useMemo(
    () => parentOptions.filter((o) => o.id !== account.id),
    [parentOptions, account.id]
  )

  async function onDelete() {
    const res = await deleteAccount(account.id)
    if (!res.ok) {
      toast.error(res.error)
      setConfirmOpen(false)
      return
    }
    toast.success("Account deleted")
    router.refresh()
    setConfirmOpen(false)
  }

  return (
    <div className="flex justify-end">
      <AccountForm
        account={account}
        parentOptions={editOptions}
        endUserOptions={editOptions}
        industries={industries}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          setEditOpen(false)
          router.refresh()
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem nativeButton={false} render={<Link href={`/accounts/${account.id}`} />}>
            View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes “{account.name}”. You must first remove its
              contacts and close any opportunities or projects, otherwise the
              delete is blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function AccountsTable({
  data,
  parentOptions,
  industries,
}: {
  data: AccountListItem[]
  parentOptions: Option[]
  industries: string[]
}) {
  const router = useRouter()

  const columns = React.useMemo<ColumnDef<AccountListItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            href={`/accounts/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "code",
        header: ({ column }) => <SortableHeader column={column} title="Code" />,
        cell: ({ row }) =>
          row.original.code ? (
            <span className="font-mono text-xs">{row.original.code}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "accountType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.accountType === "reseller" ? "Reseller" : "Client"}
          </Badge>
        ),
      },
      {
        accessorKey: "industry",
        header: "Industry",
        cell: ({ row }) => row.original.industry ?? "—",
      },
      {
        accessorKey: "ownerName",
        header: "Owner",
        cell: ({ row }) =>
          row.original.ownerName ?? (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "parentAccountName",
        header: "Parent account",
        cell: ({ row }) =>
          row.original.parentAccountId ? (
            <Link
              href={`/accounts/${row.original.parentAccountId}`}
              className="text-primary hover:underline"
            >
              {row.original.parentAccountName ?? "—"}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <SortableHeader column={column} title="Created" />
        ),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <RowActions
            account={row.original}
            parentOptions={parentOptions}
            industries={industries}
          />
        ),
        enableHiding: false,
      },
    ],
    [parentOptions, industries]
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="accounts"
      facets={[
        { columnId: "accountType", title: "Type" },
        { columnId: "industry", title: "Industry" },
        { columnId: "ownerName", title: "Owner" },
      ]}
      searchColumn="name"
      searchPlaceholder="Search accounts…"
      emptyMessage="No accounts yet."
      toolbar={
        <AccountForm
          parentOptions={parentOptions}
          endUserOptions={parentOptions}
          industries={industries}
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              New account
            </Button>
          }
          onSaved={() => router.refresh()}
        />
      }
    />
  )
}
