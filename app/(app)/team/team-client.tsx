"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"
import {
  MoreHorizontal,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DataTable, SortableHeader } from "@/components/data-table"
import { EmptyState } from "@/components/empty-state"
import { formatDate } from "@/lib/format"
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions"
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
  revokePendingInvite,
  type TeamMemberView,
  type TeamRoleView,
  type PendingInviteView,
} from "./actions"
import { isModuleEnabled } from "@/lib/modules"

// When the Advanced-roles module is off, the customization surface (custom
// roles, the permission matrix editor, seniority-tier editing) is hidden —
// leaving fixed preset roles, basic role assignment, and the reporting line.
const ADVANCED_ROLES = isModuleEnabled("advancedRoles")

// ─── Permission metadata (UI-only help + danger flags) ───────────────────────

/**
 * Elevated permissions — granting these confers administrative or
 * ownership-bypassing power, so the grid flags them so an admin doesn't hand
 * them out by mistake alongside benign grants.
 */
const ELEVATED_PERMISSIONS = new Set<string>([
  PERMISSIONS.TENANT_MANAGE_USERS,
  PERMISSIONS.TENANT_MANAGE_ROLES,
  PERMISSIONS.TENANT_SETTINGS,
  PERMISSIONS.RECORDS_VIEW_ALL,
  PERMISSIONS.RECORDS_MANAGE_ALL,
])

/** Plain-language description of what each permission lets a member do. */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [PERMISSIONS.LEAD_VIEW]: "See leads they own or manage.",
  [PERMISSIONS.LEAD_CREATE]: "Add new leads.",
  [PERMISSIONS.LEAD_UPDATE]: "Edit existing leads.",
  [PERMISSIONS.LEAD_DELETE]: "Permanently remove leads.",
  [PERMISSIONS.LEAD_CONVERT]:
    "Turn a lead into an account, contact and funnel.",
  [PERMISSIONS.ACCOUNT_VIEW]: "See accounts they own or manage.",
  [PERMISSIONS.ACCOUNT_CREATE]: "Add new accounts.",
  [PERMISSIONS.ACCOUNT_UPDATE]: "Edit existing accounts.",
  [PERMISSIONS.ACCOUNT_DELETE]: "Permanently remove accounts.",
  [PERMISSIONS.PERSON_VIEW]: "See contacts they own or manage.",
  [PERMISSIONS.PERSON_CREATE]: "Add new contacts.",
  [PERMISSIONS.PERSON_UPDATE]: "Edit existing contacts.",
  [PERMISSIONS.PERSON_DELETE]: "Permanently remove contacts.",
  [PERMISSIONS.OPPORTUNITY_VIEW]: "See pipelines on the funnel board.",
  [PERMISSIONS.OPPORTUNITY_CREATE]: "Add new pipelines.",
  [PERMISSIONS.OPPORTUNITY_UPDATE]: "Edit funnel details.",
  [PERMISSIONS.OPPORTUNITY_DELETE]: "Permanently remove pipelines.",
  [PERMISSIONS.STAGE_ADVANCE]:
    "Move pipelines forward; low tiers may need approval.",
  [PERMISSIONS.STAGE_ADVANCE_APPROVE]:
    "Approve other members' gated stage advances.",
  [PERMISSIONS.FUNNEL_MANAGE]: "Create and edit pipelines and their stages.",
  [PERMISSIONS.QUOTATION_VIEW]: "See quotations.",
  [PERMISSIONS.QUOTATION_CREATE]: "Draft new quotations.",
  [PERMISSIONS.QUOTATION_UPDATE]: "Edit draft quotations.",
  [PERMISSIONS.QUOTATION_DELETE]: "Remove quotations.",
  [PERMISSIONS.QUOTATION_SEND]: "Issue a quotation to the customer.",
  [PERMISSIONS.QUOTATION_ACCEPT]:
    "Mark a quotation accepted (can win the funnel).",
  [PERMISSIONS.TAX_VIEW]: "See tax rates and settings.",
  [PERMISSIONS.TAX_CONFIGURE]: "Add and edit tax rates.",
  [PERMISSIONS.PROJECT_VIEW]: "See projects.",
  [PERMISSIONS.PROJECT_CREATE]: "Create projects from won pipelines.",
  [PERMISSIONS.PROJECT_UPDATE]: "Edit projects and milestones.",
  [PERMISSIONS.PROJECT_DELETE]: "Permanently remove projects.",
  [PERMISSIONS.SALES_ORDER_VIEW]: "See sales orders.",
  [PERMISSIONS.SALES_ORDER_SUBMIT]: "Submit a sales order for approval.",
  [PERMISSIONS.SALES_ORDER_APPROVE]:
    "Approve or reject submitted sales orders (mints the SO number).",
  [PERMISSIONS.FORECAST_VIEW]: "See the weighted funnel forecast.",
  [PERMISSIONS.AUDIT_VIEW]: "Read the tenant audit log.",
  [PERMISSIONS.RECORDS_VIEW_ALL]:
    "Read EVERY record in the workspace, bypassing ownership.",
  [PERMISSIONS.RECORDS_MANAGE_ALL]:
    "Edit or delete ANY record in the workspace, bypassing ownership.",
  [PERMISSIONS.TENANT_MANAGE_USERS]:
    "Add, edit, disable and remove members — can grant roles.",
  [PERMISSIONS.TENANT_MANAGE_ROLES]:
    "Create roles and change their permissions and tiers.",
  [PERMISSIONS.TENANT_SETTINGS]:
    "Change workspace-wide settings (numbering, approvals, sign-in).",
}

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
  const selectedRole = roles.find((r) => r.id === roleId)
  const tierDiverges =
    selectedRole != null && (Number(tier) || 0) !== selectedRole.tierLevel

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
    const res = await addMember({
      email: email.trim(),
      roleId,
      tier: Number(tier) || 0,
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>
                Role
                <span aria-hidden="true" className="text-destructive">
                  {" "}
                  *
                </span>
              </Label>
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
            {ADVANCED_ROLES ? (
            <div className="grid gap-2">
              <Label htmlFor="add-member-tier">Tier</Label>
              <Input
                id="add-member-tier"
                type="number"
                min={0}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
              />
              {selectedRole ? (
                <p
                  className={
                    tierDiverges
                      ? "text-xs text-amber-600 dark:text-amber-500"
                      : "text-xs text-muted-foreground"
                  }
                >
                  Role default: tier {selectedRole.tierLevel}
                  {tierDiverges
                    ? " — this member will differ from the role default."
                    : "."}
                </p>
              ) : null}
            </div>
            ) : null}
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
  const selectedRole = roles.find((r) => r.id === roleId)
  const tierDiverges =
    selectedRole != null && (Number(tier) || 0) !== selectedRole.tierLevel

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
    const res = await updateMember(member.memberId, {
      roleId: roleId || null,
      tierLevel: Number(tier) || 0,
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
            {ADVANCED_ROLES ? (
            <div className="grid gap-2">
              <Label htmlFor="edit-member-tier">Tier</Label>
              <Input
                id="edit-member-tier"
                type="number"
                min={0}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
              />
              {selectedRole ? (
                <p
                  className={
                    tierDiverges
                      ? "text-xs text-amber-600 dark:text-amber-500"
                      : "text-xs text-muted-foreground"
                  }
                >
                  Role default: tier {selectedRole.tierLevel}
                  {tierDiverges
                    ? " — this member differs from the role default and may fall outside the approval-bypass threshold."
                    : "."}
                </p>
              ) : null}
            </div>
            ) : null}
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
      disabled ? "active" : "disabled"
    )
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success(disabled ? "Member reactivated" : "Member disabled")
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
    const res = role
      ? await updateRole(role.id, { name: name.trim(), tier: Number(tier) || 0 })
      : await createRole({ name: name.trim(), tier: Number(tier) || 0 })
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
            Tier drives seniority — higher tiers bypass stage-advance approvals.
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
    const res = await setRolePermissions(role.id, Array.from(checked))
    setSaving(false)
    if (!res.ok) {
      showActionError(res)
      return
    }
    toast.success("Permissions saved")
    onOpenChange(false)
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
          <TooltipProvider>
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
                        disabled={!ADVANCED_ROLES}
                        onCheckedChange={(value) =>
                          toggleGroup(groupKeys, value)
                        }
                      />
                      Select all
                    </label>
                  </div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const elevated = ELEVATED_PERMISSIONS.has(item.key)
                      const desc = PERMISSION_DESCRIPTIONS[item.key]
                      return (
                        <div
                          key={item.key}
                          className="flex items-start gap-2 text-sm"
                        >
                          <Checkbox
                            id={`perm-${item.key}`}
                            className="mt-0.5"
                            checked={checked.has(item.key)}
                            disabled={!ADVANCED_ROLES}
                            onCheckedChange={(value) => toggle(item.key, value)}
                          />
                          <div className="grid gap-0.5">
                            <label
                              htmlFor={`perm-${item.key}`}
                              className="flex cursor-pointer items-center gap-1.5 font-medium"
                            >
                              {item.label}
                              {elevated ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Badge
                                        variant="outline"
                                        className="gap-1 border-destructive/40 px-1.5 py-0 text-[10px] font-medium text-destructive"
                                      >
                                        <ShieldAlert className="size-3" />
                                        Elevated
                                      </Badge>
                                    }
                                  />
                                  <TooltipContent>
                                    Grants administrative or ownership-bypassing
                                    power — assign with care.
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </label>
                            {desc ? (
                              <span className="text-xs text-muted-foreground">
                                {desc}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          </TooltipProvider>
        )}

        <DialogFooter>
          {ADVANCED_ROLES ? (
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save permissions"}
          </Button>
          ) : null}
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
          {ADVANCED_ROLES ? (
            <>
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
        {ADVANCED_ROLES ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New role
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
            <RoleCard key={role.id} role={role} />
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
        These people join automatically (with the role and tier below) the
        first time they sign in.
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
                Tier {inv.tierLevel}
                {inv.invitedByName ? ` · invited by ${inv.invitedByName}` : ""}
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
}: {
  members: TeamMemberView[]
  roles: TeamRoleView[]
  invites?: PendingInviteView[]
}) {
  return (
    <Tabs defaultValue="members" className="w-full">
      <TabsList>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-4 grid gap-4">
        <PendingInvitesCard invites={invites} />
        <MembersTab members={members} roles={roles} />
      </TabsContent>

      <TabsContent value="roles" className="mt-4">
        <RolesTab roles={roles} />
      </TabsContent>
    </Tabs>
  )
}
