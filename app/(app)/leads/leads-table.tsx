"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal, UserPlus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { DataTable, SortableHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { showActionError } from "@/lib/show-action-error"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
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
import { formatDate } from "@/lib/format"
import { useOpenOnNewParam } from "@/hooks/use-open-on-new-param"
import { usePermissions } from "@/components/command-palette"
import { PERMISSIONS } from "@/lib/permissions"
import type {
  Option,
  FunnelWithStages,
  MemberOption,
  CountryOption,
} from "@/lib/lookups"

import { Combobox } from "@/components/ui/combobox"
import { StatusBadge } from "@/components/status-badge"
import { LeadForm } from "./lead-form"
import { ConvertDialog } from "./convert-dialog"
import {
  createLead,
  updateLead,
  deleteLead,
  restoreLead,
  disqualifyLead,
  type Lead,
  type LeadInput,
} from "./actions"

// Status pill: rendered by the app-wide <StatusBadge> tone map so the same
// meaning reads in the same color on every surface (see components/status-badge).

export function LeadsTable({
  data,
  accountOptions,
  pipelines,
  members,
  countries = [],
  leadSources = [],
  lossReasons = [],
  phonePrefix = "",
}: {
  data: Lead[]
  accountOptions: Option[]
  pipelines: FunnelWithStages[]
  members: MemberOption[]
  countries?: CountryOption[]
  /** Tenant picklists (Settings); empty = free-text fallbacks. */
  leadSources?: string[]
  lossReasons?: string[]
  /** Tenant dialing prefix prefilled on create. */
  phonePrefix?: string
}) {
  const router = useRouter()
  const perms = usePermissions()
  const canCreate = perms.has(PERMISSIONS.LEAD_CREATE)
  const canUpdate = perms.has(PERMISSIONS.LEAD_UPDATE)
  const canDelete = perms.has(PERMISSIONS.LEAD_DELETE)
  const canConvert = perms.has(PERMISSIONS.LEAD_CONVERT)

  // Resolve an owner member id to its display name for the Owner column/facet.
  const ownerNameById = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const mem of members) m.set(mem.memberId, mem.name)
    return m
  }, [members])

  const [newOpen, setNewOpen] = React.useState(false)
  // Auto-open from the header "+ New" quick-create deep link (/leads?new=1).
  useOpenOnNewParam(() => setNewOpen(true))
  const [editLead, setEditLead] = React.useState<Lead | null>(null)
  const [convertLead, setConvertLead] = React.useState<Lead | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Lead | null>(null)
  const [disqualifyTarget, setDisqualifyTarget] = React.useState<Lead | null>(null)

  // Resolve a stage id to its name for the Stage column.
  const stageNameById = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const f of pipelines) for (const s of f.stages) m.set(s.id, s.name)
    return m
  }, [pipelines])

  async function handleCreate(values: LeadInput) {
    const res = await createLead(values)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Lead created")
    setNewOpen(false)
    router.refresh()
  }

  async function handleUpdate(values: LeadInput) {
    if (!editLead) return
    const res = await updateLead(editLead.id, values)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Lead updated")
    setEditLead(null)
    router.refresh()
  }

  const columns = React.useMemo<ColumnDef<Lead>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            href={`/leads/${row.original.id}`}
            className="font-medium link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "company",
        accessorKey: "companyName",
        header: ({ column }) => (
          <SortableHeader column={column} title="Company" />
        ),
        cell: ({ row }) => {
          const lead = row.original
          // When converted, link the company to the new account.
          if (lead.convertedAccountId) {
            return (
              <Link
                href={`/accounts/${lead.convertedAccountId}`}
                className="link"
              >
                {lead.companyName || "Account"}
              </Link>
            )
          }
          return lead.companyName || "—"
        },
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) =>
          row.original.email ? (
            <a
              className="link"
              href={`mailto:${row.original.email}`}
            >
              {row.original.email}
            </a>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <SortableHeader column={column} title="Status" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "source",
        header: ({ column }) => (
          <SortableHeader column={column} title="Source" />
        ),
        cell: ({ row }) =>
          row.original.source ? (
            <span className="capitalize">{row.original.source}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "ownerName",
        // Return the resolved owner name (raw string) so the faceted Owner
        // filter groups by person rather than by opaque member id.
        accessorFn: (lead) =>
          (lead.ownerMemberId && ownerNameById.get(lead.ownerMemberId)) || "",
        header: ({ column }) => (
          <SortableHeader column={column} title="Owner" />
        ),
        cell: ({ getValue }) => {
          const name = getValue<string>()
          return name ? (
            name
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        },
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) => {
          const lead = row.original
          const name = lead.currentStageId
            ? stageNameById.get(lead.currentStageId)
            : null
          if (!name) return <span className="text-muted-foreground">—</span>
          // Link the stage to the converted funnel when one exists.
          const badge = (
            <Badge variant="outline" className="font-normal">
              {name}
            </Badge>
          )
          return lead.convertedOpportunityId ? (
            <Link href={`/opportunities/${lead.convertedOpportunityId}`}>{badge}</Link>
          ) : (
            badge
          )
        },
      },
      {
        id: "converted",
        header: "Converted to",
        cell: ({ row }) => {
          const lead = row.original
          if (
            !lead.convertedAccountId &&
            !lead.convertedPersonId &&
            !lead.convertedOpportunityId
          ) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {lead.convertedAccountId ? (
                <Link
                  href={`/accounts/${lead.convertedAccountId}`}
                  className="link"
                >
                  Account
                </Link>
              ) : null}
              {lead.convertedPersonId ? (
                <Link
                  href={`/persons/${lead.convertedPersonId}`}
                  className="link"
                >
                  Contact
                </Link>
              ) : null}
              {lead.convertedOpportunityId ? (
                <Link
                  href={`/opportunities/${lead.convertedOpportunityId}`}
                  className="link"
                >
                  Funnel
                </Link>
              ) : null}
            </div>
          )
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <SortableHeader column={column} title="Created" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const lead = row.original
          const isConverted = lead.status === "converted"
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">Open menu</span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    nativeButton={false} render={<Link href={`/leads/${lead.id}`} />}
                  >
                    View
                  </DropdownMenuItem>
                  {canUpdate ? (
                    <DropdownMenuItem onClick={() => setEditLead(lead)}>
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {canConvert ? (
                    <DropdownMenuItem
                      disabled={isConverted}
                      onClick={() => setConvertLead(lead)}
                    >
                      Convert
                    </DropdownMenuItem>
                  ) : null}
                  {canUpdate ? (
                    <DropdownMenuItem
                      disabled={isConverted || lead.status === "disqualified"}
                      onClick={() => setDisqualifyTarget(lead)}
                    >
                      Disqualify
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(lead)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [stageNameById, ownerNameById, canUpdate, canDelete, canConvert]
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        tableId="leads"
        cap={1000}
        facets={[
          { columnId: "status", title: "Status" },
          { columnId: "source", title: "Source" },
          { columnId: "ownerName", title: "Owner" },
        ]}
        searchColumn="name"
        searchPlaceholder="Search leads…"
        emptyIcon={UserPlus}
        emptyMessage="No leads yet"
        emptyDescription="Capture your first lead to start working it toward a funnel."
        emptyAction={
          canCreate ? (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              New lead
            </Button>
          ) : undefined
        }
        toolbar={
          canCreate ? (
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogTrigger render={<Button size="sm">New lead</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New lead</DialogTitle>
                </DialogHeader>
                <LeadForm
                  pipelines={pipelines}
                  sources={leadSources}
                  phonePrefix={phonePrefix}
                  onSubmit={handleCreate}
                  submitLabel="Create lead"
                />
              </DialogContent>
            </Dialog>
          ) : undefined
        }
      />

      {/* Edit dialog */}
      <Dialog
        open={!!editLead}
        onOpenChange={(o) => !o && setEditLead(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
          </DialogHeader>
          {editLead ? (
            <LeadForm
              key={editLead.id}
              lead={editLead}
              pipelines={pipelines}
              sources={leadSources}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Convert dialog */}
      {convertLead ? (
        <ConvertDialog
          lead={convertLead}
          open={!!convertLead}
          onOpenChange={(o) => !o && setConvertLead(null)}
          accountOptions={accountOptions}
          countries={countries}
        />
      ) : null}

      {/* Disqualify dialog */}
      {disqualifyTarget ? (
        <DisqualifyDialog
          lead={disqualifyTarget}
          reasons={lossReasons}
          onOpenChange={(o) => !o && setDisqualifyTarget(null)}
          onDone={() => {
            setDisqualifyTarget(null)
            router.refresh()
          }}
        />
      ) : null}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove “{deleteTarget?.name}” from your lead list. You
              can undo this right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return
                const target = deleteTarget
                const res = await deleteLead(target.id)
                if (!res.ok) {
                  showActionError(res)
                  return
                }
                toast.success("Lead deleted", {
                  action: {
                    label: "Undo",
                    onClick: async () => {
                      const r = await restoreLead(target.id)
                      if (!r.ok) {
                        showActionError(r)
                        return
                      }
                      toast.success("Lead restored")
                      router.refresh()
                    },
                  },
                })
                setDeleteTarget(null)
                router.refresh()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DisqualifyDialog({
  lead,
  onOpenChange,
  reasons = [],
  onDone,
}: {
  lead: Lead
  /** Tenant loss/disqualify reason picklist; empty = free text. */
  reasons?: string[]
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function handleDisqualify() {
    if (!reason.trim()) {
      toast.error("A reason is required")
      return
    }
    setSubmitting(true)
    try {
      const res = await disqualifyLead(lead.id, reason)
      if (!res.ok) {
        showActionError(res)
        return
      }
      toast.success("Lead disqualified")
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disqualify lead</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="disqualify-reason">Reason</Label>
          {reasons.length > 0 ? (
            <Combobox
              value={reason}
              onChange={(v) => setReason(v ?? "")}
              options={reasons.map((r) => ({ value: r, label: r }))}
              placeholder="Pick a reason…"
              searchPlaceholder="Search reasons…"
              emptyMessage="No reasons found."
            />
          ) : (
            <Input
              id="disqualify-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="No budget, wrong fit…"
            />
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDisqualify}
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Disqualify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
