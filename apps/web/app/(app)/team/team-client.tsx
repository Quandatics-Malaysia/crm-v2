"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import { MoreHorizontal, Plus, ShieldCheck, Users } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { DataTable, SortableHeader } from "@/components/data-table"
import { EmptyState } from "@/components/empty-state"
import { formatDate } from "@/lib/format"
import {
  addMember,
  updateMember,
  removeMember,
  setMemberStatus,
  createRole,
  updateRole,
  deleteRole,
  revokePendingInvite,
  type TeamMemberView,
  type TeamRoleView,
  type PendingInviteView,
} from "./actions"

// ─── Members: Add dialog ─────────────────────────────────────────────────────

function AddMemberDialog({ roles }: { roles: TeamRoleView[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [roleId, setRoleId] = React.useState<string>(roles[0]?.id ?? "")

  const roleItems = React.useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles]
  )

  // Reset the form each time the dialog transitions to open
  // (adjust-during-render — no effect, satisfies set-state-in-effect).
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setEmail("")
      setRoleId(roles[0]?.id ?? "")
    }
  }

  function onRoleChange(value: string | null) {
    setRoleId(value ?? "")
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await addMember({
      email: email.trim(),
      roleId,
    })
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(
      res.data.invited
        ? "Invitation recorded — they join automatically on first sign-in"
        : "Member added"
    )
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            Add member
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add someone by email. If they haven&apos;t signed in yet, a pending
            invite is recorded and they join automatically on first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="add-member-email">
              Email
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
            </Label>
            <Input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>
              Role
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
            </Label>
            <Select value={roleId} onValueChange={onRoleChange} items={roleItems}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a role" />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              You can assign more roles after they&apos;re added — access is the
              union of every role.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !roleId}>
              {saving ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Members: Edit dialog ────────────────────────────────────────────────────

function EditMemberDialog({
  open,
  onOpenChange,
  member,
  roles,
  members,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  member: TeamMemberView
  roles: TeamRoleView[]
  members: TeamMemberView[]
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [roleIds, setRoleIds] = React.useState<string[]>(member.roleIds)
  const [managerId, setManagerId] = React.useState<string>(
    member.managerMemberId ?? "none"
  )

  const managerItems = React.useMemo(
    () => [
      { value: "none", label: "No manager" },
      ...members
        .filter((m) => m.memberId !== member.memberId)
        .map((m) => ({ value: m.memberId, label: m.name })),
    ],
    [members, member.memberId]
  )
  const sortedRoles = React.useMemo(
    () => [...roles].sort((a, b) => a.name.localeCompare(b.name)),
    [roles]
  )

  function toggleRole(id: string, checked: boolean) {
    setRoleIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((r) => r !== id)
    )
  }

  // Reset to the member's current values whenever the dialog opens.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setRoleIds(member.roleIds)
      setManagerId(member.managerMemberId ?? "none")
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await updateMember(member.memberId, {
      roleIds,
      managerMemberId: managerId === "none" ? null : managerId,
    })
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Member updated")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label>Roles</Label>
            <p className="text-xs text-muted-foreground">
              A member can hold several roles. Their access is the union of every
              role&apos;s permissions.
            </p>
            <div className="grid gap-1.5 rounded-md border p-3 max-h-52 overflow-y-auto">
              {sortedRoles.map((r) => {
                const checked = roleIds.includes(r.id)
                return (
                  <label
                    key={r.id}
                    className="flex items-center gap-2.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleRole(r.id, v === true)}
                    />
                    <span className="font-medium">{r.name}</span>
                    {r.isSystem ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        System
                      </Badge>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Manager</Label>
            <Select
              value={managerId}
              onValueChange={(v) => setManagerId(v ?? "none")}
              items={managerItems}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No manager" />
              </SelectTrigger>
              <SelectContent>
                {managerItems.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Members: Row actions ────────────────────────────────────────────────────

function MemberRowActions({
  member,
  roles,
  members,
}: {
  member: TeamMemberView
  roles: TeamRoleView[]
  members: TeamMemberView[]
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const inactive = member.status !== "active"

  async function onRemove() {
    setBusy(true)
    const res = await removeMember(member.memberId)
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Member removed")
    setConfirmOpen(false)
    router.refresh()
  }

  async function onToggleStatus() {
    const res = await setMemberStatus(
      member.memberId,
      inactive ? "active" : "disabled"
    )
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(inactive ? "Member reactivated" : "Member disabled")
    router.refresh()
  }

  return (
    <div className="flex justify-end">
      <EditMemberDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        member={member}
        roles={roles}
        members={members}
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
            Edit roles &amp; manager
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleStatus}>
            {inactive ? "Reactivate" : "Disable access"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {member.name} from this workspace. Their account and
              other memberships are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRemove}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Members: Table ──────────────────────────────────────────────────────────

function MembersTab({
  members,
  roles,
  canManageUsers,
}: {
  members: TeamMemberView[]
  roles: TeamRoleView[]
  canManageUsers: boolean
}) {
  const columns = React.useMemo<ColumnDef<TeamMemberView>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        id: "roles",
        accessorFn: (r) => r.roleNames.join(", "),
        header: "Roles",
        cell: ({ row }) =>
          row.original.roleNames.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.roleNames.map((n) => (
                <Badge key={n} variant="secondary">
                  {n}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "manager",
        accessorFn: (r) => r.managerName ?? "",
        header: "Manager",
        cell: ({ row }) =>
          row.original.managerName ? (
            <span>{row.original.managerName}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "lastActive",
        accessorFn: (r) => r.lastLoginAt?.getTime() ?? 0,
        header: ({ column }) => (
          <SortableHeader column={column} title="Last active" />
        ),
        cell: ({ row }) => {
          const { lastLoginAt, lastActiveAt } = row.original
          if (!lastLoginAt && !lastActiveAt) {
            return <span className="text-muted-foreground">Never</span>
          }
          return (
            <div className="grid gap-0.5 text-sm">
              <span>{lastLoginAt ? formatDate(lastLoginAt) : "—"}</span>
              {lastActiveAt ? (
                <span
                  className="text-xs text-muted-foreground"
                  title="Approximate — newest session refresh"
                >
                  seen ~{formatDate(lastActiveAt)}
                </span>
              ) : null}
            </div>
          )
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <MemberRowActions
            member={row.original}
            roles={roles}
            members={members}
          />
        ),
        enableHiding: false,
      },
    ],
    [roles, members]
  )

  return (
    <DataTable
      columns={columns}
      data={members}
      searchColumn="name"
      searchPlaceholder="Search members…"
      emptyMessage="No members yet."
      facets={[
        { columnId: "roles", title: "Role" },
        { columnId: "manager", title: "Manager" },
      ]}
      toolbar={canManageUsers ? <AddMemberDialog roles={roles} /> : undefined}
    />
  )
}

// ─── Roles: Edit / create dialog ─────────────────────────────────────────────

function RoleFormDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  role?: TeamRoleView
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState(role?.name ?? "")

  // Reset to the role's current values whenever the dialog opens.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(role?.name ?? "")
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = role
      ? await updateRole(role.id, { name: name.trim() })
      : await createRole({ name: name.trim() })
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(role ? "Role updated" : "Role created")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? "Edit role" : "New role"}</DialogTitle>
          <DialogDescription>
            Give the role a clear name. Set what it can do from the permissions
            editor — a member&apos;s access is the union of all their roles.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="role-name">
              Name
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
            </Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Regional Manager"
              disabled={role?.isSystem}
              required
            />
            {role?.isSystem ? (
              <p className="text-xs text-muted-foreground">
                System roles can&apos;t be renamed.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : role ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Roles: Card ─────────────────────────────────────────────────────────────

function RoleCard({
  role,
  advancedRoles,
}: {
  role: TeamRoleView
  advancedRoles: boolean
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    setBusy(true)
    const res = await deleteRole(role.id)
    setBusy(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Role deleted")
    setConfirmOpen(false)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {role.name}
          {role.isSystem ? (
            <Badge variant="outline" className="font-normal">
              System
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {role.description ??
            (role.isSystem ? "Built-in role" : "Custom role")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {role.memberCount} member{role.memberCount === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-3.5" />
            {role.permissionCount} permission
            {role.permissionCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {advancedRoles ? (
            <>
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/team/roles?role=${role.id}`} />}
              >
                <ShieldCheck className="size-3.5" />
                Permissions
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={role.isSystem}
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>

      <RoleFormDialog open={editOpen} onOpenChange={setEditOpen} role={role} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the “{role.name}” role. Roles in use by a
              member can&apos;t be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function RolesTab({
  roles,
  advancedRoles,
}: {
  roles: TeamRoleView[]
  advancedRoles: boolean
}) {
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {roles.length} role{roles.length === 1 ? "" : "s"}
        </p>
        {advancedRoles ? (
          <Button size="sm" render={<Link href="/team/roles" />}>
            <ShieldCheck className="size-4" />
            Roles &amp; permissions
          </Button>
        ) : null}
      </div>

      {roles.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="No roles yet." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role} advancedRoles={advancedRoles} />
          ))}
        </div>
      )}

      <RoleFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

/** Invites waiting on the person's first sign-in, with revoke. */
function PendingInvitesCard({ invites }: { invites: PendingInviteView[] }) {
  const router = useRouter()
  if (invites.length === 0) return null
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Pending invites</h3>
      <p className="text-xs text-muted-foreground">
        These people join automatically (with the role below) the first time
        they sign in.
      </p>
      <div className="mt-3 grid gap-2">
        {invites.map((inv) => (
          <div
            key={inv.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{inv.email}</span>
              <Badge variant="outline">{inv.roleName ?? "Rep"}</Badge>
              <span className="text-xs text-muted-foreground">
                {inv.invitedByName ? `Invited by ${inv.invitedByName}` : ""}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const res = await revokePendingInvite(inv.id)
                if (!res.ok) {
                  showActionError(res)
                  return
                }
                toast.success("Invite revoked")
                router.refresh()
              }}
            >
              Revoke
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TeamClient({
  members,
  roles,
  invites = [],
  canManageUsers,
  advancedRoles,
}: {
  members: TeamMemberView[]
  roles: TeamRoleView[]
  invites?: PendingInviteView[]
  canManageUsers: boolean
  advancedRoles: boolean
}) {
  return (
    <Tabs defaultValue="members" className="w-full">
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-4 grid gap-4">
        <PendingInvitesCard invites={invites} />
        <MembersTab members={members} roles={roles} canManageUsers={canManageUsers} />
      </TabsContent>

      <TabsContent value="roles" className="mt-4">
        <RolesTab roles={roles} advancedRoles={advancedRoles} />
      </TabsContent>
    </Tabs>
  )
}
