"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, MoreHorizontal, Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { showActionError } from "@/lib/show-action-error"
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
import { useOpenOnNewParam } from "@/hooks/use-open-on-new-param"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import type { Option, CountryOption } from "@/lib/lookups"
import { AccountForm } from "./account-form"
import { deleteAccount, restoreAccount, type AccountListItem } from "./actions"

function RowActions({
  account,
  parentOptions,
  industries,
  countries,
}: {
  account: AccountListItem
  parentOptions: Option[]
  industries: string[]
  countries: CountryOption[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canUpdate = perms.has(PERMISSIONS.ACCOUNT_UPDATE)
  const canDelete = perms.has(PERMISSIONS.ACCOUNT_DELETE)
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
      showActionError(res)
      setConfirmOpen(false)
      return
    }
    toast.success("Account deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await restoreAccount(account.id)
          if (!r.ok) {
            showActionError(r)
            return
          }
          toast.success("Account restored")
          router.refresh()
        },
      },
    })
    router.refresh()
    setConfirmOpen(false)
  }

  return (
    <div className="flex justify-end">
      {canUpdate ? (
        <AccountForm
          account={account}
          parentOptions={editOptions}
          endUserOptions={editOptions}
          industries={industries}
          countries={countries}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            setEditOpen(false)
            router.refresh()
          }}
        />
      ) : null}

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
          {canUpdate ? (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              Edit
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes “{account.name}”. You must first remove its
              contacts, close any Funnels or projects, and reassign any child
              accounts or reseller links, otherwise the delete is blocked. You
              can undo this right after.
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
  countries,
  presets,
}: {
  data: AccountListItem[]
  parentOptions: Option[]
  industries: string[]
  countries: CountryOption[]
  /** Tenant form presets (default country / phone prefix) for the create form. */
  presets?: { defaultCountry: string; phonePrefix: string }
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canCreate = perms.has(PERMISSIONS.ACCOUNT_CREATE)
  const [newOpen, setNewOpen] = React.useState(false)
  // Auto-open from the header "+ New" quick-create deep link (/accounts?new=1).
  useOpenOnNewParam(() => setNewOpen(true))

  const columns = React.useMemo<ColumnDef<AccountListItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            href={`/accounts/${row.original.id}`}
            className="font-medium link"
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
              className="link"
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
            countries={countries}
          />
        ),
        enableHiding: false,
      },
    ],
    [parentOptions, industries, countries]
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      tableId="accounts"
      cap={1000}
      facets={[
        { columnId: "accountType", title: "Type" },
        { columnId: "industry", title: "Industry" },
        { columnId: "ownerName", title: "Owner" },
      ]}
      searchColumn="name"
      searchPlaceholder="Search accounts…"
      emptyIcon={Building2}
      emptyMessage="No accounts yet"
      emptyDescription="Add a customer account to start tracking contacts and Funnels."
      emptyAction={
        canCreate ? (
          <AccountForm
            parentOptions={parentOptions}
            endUserOptions={parentOptions}
            industries={industries}
            countries={countries}
            presets={presets}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New account
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
      toolbar={
        canCreate ? (
          <AccountForm
            parentOptions={parentOptions}
            endUserOptions={parentOptions}
            industries={industries}
            countries={countries}
            presets={presets}
            open={newOpen}
            onOpenChange={setNewOpen}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New account
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
    />
  )
}
