"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Building2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  EditIcon,
  Trash2Icon,
} from "lucide-react"

import {
  archiveOrganization,
  listAllOrganizations,
  updateOrganization,
  type OrgRow,
} from "@/app/(app)/_shared/entity-actions"
import { showActionError } from "@/lib/show-action-error"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

function EditOrgDialog({
  org,
  onClose,
  onSaved,
}: {
  org: OrgRow
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState(org.name)
  const [entityCode, setEntityCode] = React.useState(org.entityCode ?? "")
  const [suspended, setSuspended] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const res = await updateOrganization(org.id, {
      name: name.trim(),
      entityCode: entityCode.trim() || null,
      suspended,
    })
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(`"${name.trim()}" updated`)
    onSaved()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit organization</DialogTitle>
          <DialogDescription>
            {org.slug}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="org-name">Customer name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. QAR Enterprise"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-code">Entity code</Label>
            <Input
              id="org-code"
              value={entityCode}
              onChange={(e) => setEntityCode(e.target.value.toUpperCase())}
              placeholder="e.g. QAR"
              maxLength={16}
              className="uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Used in project codes. Max 16 characters.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">Suspended</span>
              <span className="text-xs text-muted-foreground">
                Suspended orgs lock all members out.
              </span>
            </div>
            <Switch checked={suspended} onCheckedChange={setSuspended} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmArchiveDialog({
  org,
  onClose,
  onArchived,
}: {
  org: OrgRow
  onClose: () => void
  onArchived: () => void
}) {
  const [busy, setBusy] = React.useState(false)

  async function archive() {
    setBusy(true)
    const res = await archiveOrganization(org.id)
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(`"${org.name}" archived`)
    onArchived()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Archive &quot;{org.name}&quot;?</DialogTitle>
          <DialogDescription>
            Archived organizations are hidden from the org picker but all data is
            retained. This cannot be undone from the UI.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={archive}
            disabled={busy}
          >
            {busy ? "Archiving…" : "Archive organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ManageOrganizationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [orgs, setOrgs] = React.useState<OrgRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editingOrg, setEditingOrg] = React.useState<OrgRow | null>(null)
  const [archivingOrg, setArchivingOrg] = React.useState<OrgRow | null>(null)
  const [showArchived, setShowArchived] = React.useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await listAllOrganizations()
      setOrgs(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load organizations")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally calling setLoading(true) to reflect loading state
    setLoading(true)
    let active = true
    listAllOrganizations()
      .then((data) => { if (active) setOrgs(data) })
      .catch((e) => { if (active) toast.error(e instanceof Error ? e.message : "Failed to load organizations") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  const activeOrgs = orgs.filter((o) => o.status !== "archived")
  const archivedOrgs = orgs.filter((o) => o.status === "archived")
  const displayedArchived = showArchived ? archivedOrgs : []

  function orgStatusBadge(org: OrgRow) {
    if (org.status === "archived")
      return (
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          archived
        </span>
      )
    return null
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Organizations</DialogTitle>
            <DialogDescription>
              Manage all customer organizations on this platform.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <div className="grid gap-3">
              {/* Active orgs */}
              {activeOrgs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No active organizations.
                </p>
              ) : (
                activeOrgs.map((org) => (
                  <OrgRow
                    key={org.id}
                    org={org}
                    badge={orgStatusBadge(org)}
                    onEdit={() => setEditingOrg(org)}
                    onArchive={() => setArchivingOrg(org)}
                  />
                ))
              )}

              {/* Archived orgs */}
              {archivedOrgs.length > 0 && (
                <div className="pt-2">
                  <button
                    type="button"
                    className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowArchived((v) => !v)}
                  >
                    {showArchived ? (
                      <ChevronUpIcon className="size-3" />
                    ) : (
                      <ChevronDownIcon className="size-3" />
                    )}
                    {archivedOrgs.length} archived
                  </button>
                  {displayedArchived.map((org) => (
                    <OrgRow
                      key={org.id}
                      org={org}
                      badge={orgStatusBadge(org)}
                      onEdit={() => setEditingOrg(org)}
                      onArchive={undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingOrg ? (
        <EditOrgDialog
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={load}
        />
      ) : null}

      {archivingOrg ? (
        <ConfirmArchiveDialog
          org={archivingOrg}
          onClose={() => setArchivingOrg(null)}
          onArchived={load}
        />
      ) : null}
    </>
  )
}

function OrgRow({
  org,
  badge,
  onEdit,
  onArchive,
}: {
  org: OrgRow
  badge: React.ReactNode
  onEdit: () => void
  onArchive?: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Building2Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="grid flex-1 gap-0.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate font-medium text-sm">{org.name}</span>
          {badge}
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{org.slug}</span>
          {org.entityCode ? (
            <span className="font-mono">· {org.entityCode}</span>
          ) : null}
          <span>· {org.memberCount} member{org.memberCount !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <span className="sr-only">Options</span>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle cx="7.5" cy="3" r="1.25" fill="currentColor" />
                <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
                <circle cx="7.5" cy="12" r="1.25" fill="currentColor" />
              </svg>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <EditIcon className="mr-2 size-4" />
            Edit
          </DropdownMenuItem>
          {onArchive ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={onArchive}
              >
                <Trash2Icon className="mr-2 size-4" />
                Archive
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
