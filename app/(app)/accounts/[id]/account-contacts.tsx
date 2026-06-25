"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Plus, Star } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { PersonForm } from "../../persons/person-form"
import {
  deletePerson,
  setPrimaryPerson,
  type PersonRow,
} from "../../persons/actions"

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ")
}

function ContactActions({ person }: { person: PersonRow }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)

  async function onDelete() {
    try {
      await deletePerson(person.id)
      toast.success("Contact deleted")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    }
    setConfirmOpen(false)
  }

  async function onMakePrimary() {
    try {
      await setPrimaryPerson(person.id)
      toast.success("Marked as primary contact")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <div className="flex justify-end">
      <PersonForm
        person={person}
        presetAccountId={person.accountId}
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
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {!person.isPrimary ? (
            <DropdownMenuItem onClick={onMakePrimary}>
              Make primary
            </DropdownMenuItem>
          ) : null}
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
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {fullName(person) || "this contact"} from the account.
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

export function AccountContacts({
  accountId,
  contacts,
}: {
  accountId: string
  contacts: PersonRow[]
}) {
  const router = useRouter()

  const columns = React.useMemo<ColumnDef<PersonRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => fullName(row),
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{fullName(row.original)}</span>
            {row.original.isPrimary ? (
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => row.original.title ?? "—",
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) =>
          row.original.email ? (
            <a
              href={`mailto:${row.original.email}`}
              className="text-primary hover:underline"
            >
              {row.original.email}
            </a>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => row.original.phone ?? "—",
      },
      {
        id: "primary",
        header: "Primary",
        cell: ({ row }) =>
          row.original.isPrimary ? (
            <Badge variant="secondary">Primary</Badge>
          ) : null,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => <ContactActions person={row.original} />,
        enableHiding: false,
      },
    ],
    []
  )

  return (
    <DataTable
      columns={columns}
      data={contacts}
      searchColumn="name"
      searchPlaceholder="Search contacts…"
      emptyMessage="No contacts on this account yet."
      pageSize={5}
      toolbar={
        <PersonForm
          presetAccountId={accountId}
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              Add contact
            </Button>
          }
          onSaved={() => router.refresh()}
        />
      }
    />
  )
}
