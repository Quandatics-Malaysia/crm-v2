"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Plus, Star, Users } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { useOpenOnNewParam } from "@/hooks/use-open-on-new-param"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import type { Option } from "@/lib/lookups"
import { PersonForm } from "./person-form"
import {
  deletePerson,
  restorePerson,
  setPrimaryPerson,
  type PersonListItem,
} from "./actions"

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

function RowActions({
  person,
  accounts,
}: {
  person: PersonListItem
  accounts: Option[]
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canUpdate = perms.has(PERMISSIONS.PERSON_UPDATE)
  const canDelete = perms.has(PERMISSIONS.PERSON_DELETE)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  async function onDelete() {
    const res = await deletePerson(person.id)
    if (!res.ok) {
      showActionError(res)
      setConfirmOpen(false)
      return
    }
    toast.success("Contact deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await restorePerson(person.id)
          if (!r.ok) {
            showActionError(r)
            return
          }
          toast.success("Contact restored")
          router.refresh()
        },
      },
    })
    router.refresh()
    setConfirmOpen(false)
  }

  async function onMakePrimary() {
    const res = await setPrimaryPerson(person.id)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Marked as primary contact")
    router.refresh()
  }

  return (
    <div className="flex justify-end">
      {canUpdate ? (
        <PersonForm
          accounts={accounts}
          person={person}
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
          {canUpdate ? (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              Edit
            </DropdownMenuItem>
          ) : null}
          {canUpdate && !person.isPrimary ? (
            <DropdownMenuItem onClick={onMakePrimary}>
              Make primary
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
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {fullName(person) || "this contact"} from the account.
              You can undo this right after.
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

export function PersonsTable({
  data,
  accounts,
  phonePrefix = "",
  defaultCountry,
}: {
  data: PersonListItem[]
  accounts: Option[]
  /** Tenant dialing prefix prefilled on create. */
  phonePrefix?: string
  defaultCountry?: string
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canCreate = perms.has(PERMISSIONS.PERSON_CREATE)
  const [newOpen, setNewOpen] = React.useState(false)
  // Auto-open from the header "+ New" quick-create deep link (/persons?new=1).
  useOpenOnNewParam(() => setNewOpen(true))

  const columns = React.useMemo<ColumnDef<PersonListItem>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => fullName(row),
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/persons/${row.original.id}`}
              className="font-medium link"
            >
              {fullName(row.original) || "Unnamed contact"}
            </Link>
            {row.original.isPrimary ? (
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "accountName",
        header: ({ column }) => (
          <SortableHeader column={column} title="Account" />
        ),
        cell: ({ row }) =>
          row.original.accountId ? (
            <Link
              href={`/accounts/${row.original.accountId}`}
              className="link"
            >
              {row.original.accountName ?? "—"}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) =>
          row.original.email ? (
            <a
              href={`mailto:${row.original.email}`}
              className="link"
            >
              {row.original.email}
            </a>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => row.original.title ?? "—",
      },
      {
        accessorKey: "department",
        header: "Department",
        cell: ({ row }) => row.original.department ?? "—",
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => row.original.phone ?? "—",
      },
      {
        id: "primary",
        accessorFn: (row) => (row.isPrimary ? "Primary" : "Other"),
        header: "Primary",
        cell: ({ row }) =>
          row.original.isPrimary ? (
            <Badge variant="secondary">Primary</Badge>
          ) : null,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <RowActions person={row.original} accounts={accounts} />
        ),
        enableHiding: false,
      },
    ],
    [accounts]
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      searchColumn="name"
      searchPlaceholder="Search contacts…"
      emptyIcon={Users}
      emptyMessage="No contacts yet"
      emptyDescription="Add a contact and link them to an account to start engaging."
      emptyAction={
        canCreate ? (
          <PersonForm
            accounts={accounts}
            phonePrefix={phonePrefix}
            defaultCountry={defaultCountry}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New contact
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
      filters={[
        { type: "relation", columnId: "accountName", title: "Account", options: Array.from(new Set(data.map((row) => row.accountName).filter((value): value is string => Boolean(value)))).map((value) => ({ value, label: value })) },
        { type: "enum", columnId: "primary", title: "Primary", options: [{ value: "Primary", label: "Primary" }, { value: "Other", label: "Other" }] },
      ]}
      tableId="persons"
      cap={1000}
      toolbar={
        canCreate ? (
          <PersonForm
            accounts={accounts}
            phonePrefix={phonePrefix}
            defaultCountry={defaultCountry}
            open={newOpen}
            onOpenChange={setNewOpen}
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                New contact
              </Button>
            }
            onSaved={() => router.refresh()}
          />
        ) : undefined
      }
    />
  )
}
