"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Copy, ShieldAlert } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { showActionError } from "@/lib/show-action-error"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { formatDate } from "@/lib/format"
import { createApiKey, revokeApiKey, type ApiKeyRow } from "./actions"

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
})

type FormValues = z.infer<typeof schema>

// ─── Create dialog ──────────────────────────────────────────────────────────

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [created, setCreated] = React.useState<{ fullKey: string } | null>(null)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  })

  function handleOpenChange(o: boolean) {
    if (!o) {
      // Drop the one-time key from memory as soon as the dialog closes, and
      // reset the form so the next open starts clean.
      setCreated(null)
      form.reset({ name: "" })
      router.refresh()
    }
    onOpenChange(o)
  }

  async function onSubmit(values: FormValues) {
    setSaving(true)
    const res = await createApiKey(values.name)
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    setCreated({ fullKey: res.data.fullKey })
    toast.success("API key created")
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm">Create API key</Button>} />
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy it now — for security, we only show the full key once. If
                you lose it, revoke it and create a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-muted/40 px-3 font-mono text-sm">
                  {created.fullKey}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(created.fullKey)
                    toast.success("API key copied")
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                You won&apos;t be able to see this key again after closing this
                dialog.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                The key acts as you and inherits your current role&apos;s
                permissions. Give it a name that identifies where it&apos;s
                used.
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
                        <Input placeholder="e.g. Zapier integration" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

function RevokeAction({ row }: { row: ApiKeyRow }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onRevoke() {
    setBusy(true)
    const res = await revokeApiKey(row.id)
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("API key revoked")
    setConfirmOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        Revoke
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{row.name}&rdquo; ({row.keyPrefix}…) will stop working
              immediately. This can&apos;t be undone — anything using this key
              will need a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRevoke}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function AccessClient({ data }: { data: ApiKeyRow[] }) {
  const [createOpen, setCreateOpen] = React.useState(false)

  const columns: ColumnDef<ApiKeyRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortableHeader column={column} title="Name" />,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "keyPrefix",
      header: "Key",
      cell: ({ row }) => (
        <code className="font-mono text-xs text-muted-foreground">
          {row.original.keyPrefix}…
        </code>
      ),
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <SortableHeader column={column} title="Created" />,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      accessorKey: "lastUsedAt",
      header: "Last used",
      cell: ({ row }) =>
        row.original.lastUsedAt ? (
          formatDate(row.original.lastUsedAt)
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.revokedAt ? (
          <Badge variant="secondary">Revoked</Badge>
        ) : (
          <Badge variant="outline">Active</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.revokedAt ? null : <RevokeAction row={row.original} />,
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchColumn="name"
        searchPlaceholder="Search API keys…"
        emptyMessage="No API keys yet."
        toolbar={
          <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
        }
      />
    </>
  )
}
