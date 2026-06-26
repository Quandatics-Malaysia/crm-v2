"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import { Separator } from "@/components/ui/separator"
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
import { PERMISSION_GROUPS } from "@/lib/permissions"
import {
  addMember,
  updateMember,
  removeMember,
  setMemberStatus,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  setRolePermissions,
  type TeamMemberView,
  type TeamRoleView,
} from "./actions"

// ─── Members: Add dialog ─────────────────────────────────────────────────────

function AddMemberDialog({ roles }: { roles: TeamRoleView[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [roleId, setRoleId] = React.useState<string>(roles[0]?.id ?? "")
  const [tier, setTier] = React.useState<string>(
    String(roles[0]?.tierLevel ?? 0)
  )

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
      const first = roles[0]
      setEmail("")
      setRoleId(first?.id ?? "")
      setTier(String(first?.tierLevel ?? 0))
    }
  }

  function onRoleChange(value: string | null) {
    const next = value ?? ""
    setRoleId(next)
    const r = roles.find((x) => x.id === next)
    if (r) setTier(String(r.tierLevel))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await addMember({
        email: email.trim(),
        roleId,
        tier: Number(tier) || 0,
      })
      toast.success("Member added")
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member")
    } finally {
      setSaving(false)
    }
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
            Invite an existing user by email. They must have signed in at least
            once.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="add-member-email">Email</Label>
            <Input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select
                value={roleId}
                onValueChange={onRoleChange}
                items={roleItems}
              >
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-member-tier">Tier</Label>
              <Input
                id="add-member-tier"
                type="number"
                min={0}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
              />
            </div>
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
  const [roleId, setRoleId] = React.useState<string>(member.roleId ?? "")
  const [tier, setTier] = React.useState<string>(String(member.tierLevel))
  const [managerId, setManagerId] = React.useState<string>(
    member.managerMemberId ?? "none"
  )

  const roleItems = React.useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles]
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

  // Reset to the member's current values whenever the dialog opens.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setRoleId(member.roleId ?? "")
      setTier(String(member.tierLevel))
      setManagerId(member.managerMemberId ?? "none")
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateMember(member.memberId, {
        roleId: roleId || null,
        tierLevel: Number(tier) || 0,
        managerMemberId: managerId === "none" ? null : managerId,
      })
      toast.success("Member updated")
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update member")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select
                value={roleId}
                onValueChange={(v) => setRoleId(v ?? "")}
                items={roleItems}
              >
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-member-tier">Tier</Label>
              <Input
                id="edit-member-tier"
                type="number"
                min={0}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
              />
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

  const disabled = member.status === "disabled"

  async function onRemove() {
    setBusy(true)
    try {
      await removeMember(member.memberId)
      toast.success("Member removed")
      setConfirmOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove")
    } finally {
      setBusy(false)
    }
  }

  async function onToggleStatus() {
    try {
      await setMemberStatus(member.memberId, disabled ? "active" : "disabled")
      toast.success(disabled ? "Member reactivated" : "Member disabled")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status")
    }
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
            Edit role, tier &amp; manager
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleStatus}>
            {disabled ? "Reactivate" : "Disable access"}
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
              This removes {member.name} from this entity. Their account and
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
}: {
  members: TeamMemberView[]
  roles: TeamRoleView[]
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
        id: "role",
        accessorFn: (r) => r.roleName ?? "",
        header: "Role",
        cell: ({ row }) =>
          row.original.roleName ? (
            <Badge variant="secondary">{row.original.roleName}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "tierLevel",
        header: ({ column }) => <SortableHeader column={column} title="Tier" />,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.tierLevel}</span>
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
        { columnId: "role", title: "Role" },
        { columnId: "manager", title: "Manager" },
      ]}
      toolbar={<AddMemberDialog roles={roles} />}
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
  const [tier, setTier] = React.useState(String(role?.tierLevel ?? 0))

  // Reset to the role's current values whenever the dialog opens.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(role?.name ?? "")
      setTier(String(role?.tierLevel ?? 0))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (role) {
        await updateRole(role.id, { name: name.trim(), tier: Number(tier) || 0 })
        toast.success("Role updated")
      } else {
        await createRole({ name: name.trim(), tier: Number(tier) || 0 })
        toast.success("Role created")
      }
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? "Edit role" : "New role"}</DialogTitle>
          <DialogDescription>
            Tier drives seniority — higher tiers bypass stage-advance approvals.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="role-name">Name</Label>
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
          <div className="grid gap-2">
            <Label htmlFor="role-tier">Tier</Label>
            <Input
              id="role-tier"
              type="number"
              min={0}
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            />
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

// ─── Roles: Permissions dialog ───────────────────────────────────────────────

function PermissionsDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  role: TeamRoleView
}) {
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [checked, setChecked] = React.useState<Set<string>>(new Set())

  // Flag the loading state synchronously at open (adjust-during-render), then
  // fetch the role's current grants in an effect (legit external read).
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLoading(true)
      setChecked(new Set())
    }
  }

  React.useEffect(() => {
    if (!open) return
    let active = true
    getRolePermissions(role.id)
      .then((keys) => {
        if (active) setChecked(new Set(keys))
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to load permissions"
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, role.id])

  function toggle(key: string, value: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function toggleGroup(keys: string[], value: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (value) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  async function onSave() {
    setSaving(true)
    try {
      await setRolePermissions(role.id, Array.from(checked))
      toast.success("Permissions saved")
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save permissions"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissions · {role.name}</DialogTitle>
          <DialogDescription>
            Choose what members with this role can do.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : (
          <div className="grid max-h-[55vh] gap-5 overflow-y-auto pr-1">
            {PERMISSION_GROUPS.map((group) => {
              const groupKeys = group.items.map((i) => i.key)
              const allChecked = groupKeys.every((k) => checked.has(k))
              const someChecked = groupKeys.some((k) => checked.has(k))
              return (
                <div key={group.group} className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{group.group}</span>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={allChecked}
                        indeterminate={!allChecked && someChecked}
                        onCheckedChange={(value) =>
                          toggleGroup(groupKeys, value)
                        }
                      />
                      Select all
                    </label>
                  </div>
                  <Separator />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map((item) => (
                      <label
                        key={item.key}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={checked.has(item.key)}
                          onCheckedChange={(value) => toggle(item.key, value)}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Roles: Card ─────────────────────────────────────────────────────────────

function RoleCard({ role }: { role: TeamRoleView }) {
  const router = useRouter()
  const [permsOpen, setPermsOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    setBusy(true)
    try {
      await deleteRole(role.id)
      toast.success("Role deleted")
      setConfirmOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    } finally {
      setBusy(false)
    }
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
          {role.description ?? `Tier ${role.tierLevel}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums">Tier {role.tierLevel}</span>
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
          <Button size="sm" variant="outline" onClick={() => setPermsOpen(true)}>
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
        </div>
      </CardContent>

      <PermissionsDialog
        open={permsOpen}
        onOpenChange={setPermsOpen}
        role={role}
      />
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

function RolesTab({ roles }: { roles: TeamRoleView[] }) {
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {roles.length} role{roles.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          New role
        </Button>
      </div>

      {roles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No roles yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role} />
          ))}
        </div>
      )}

      <RoleFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function TeamClient({
  members,
  roles,
}: {
  members: TeamMemberView[]
  roles: TeamRoleView[]
}) {
  return (
    <Tabs defaultValue="members" className="w-full">
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-4">
        <MembersTab members={members} roles={roles} />
      </TabsContent>

      <TabsContent value="roles" className="mt-4">
        <RolesTab roles={roles} />
      </TabsContent>
    </Tabs>
  )
}
