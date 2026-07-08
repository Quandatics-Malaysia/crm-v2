"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, ShieldCheck, Users, Trash2, Pencil } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { showActionError } from "@/lib/show-action-error"
import { PERMISSION_GROUPS } from "@/lib/permissions"
import {
  setRolePermissions,
  createRole,
  updateRole,
  deleteRole,
  type RoleWithPermissions,
  type PermissionAdmin,
} from "../actions"

// Group the permission catalog into tabbed areas.
const AREAS: { id: string; label: string; groups: string[] }[] = [
  { id: "crm", label: "CRM", groups: ["Leads", "Accounts", "Contacts"] },
  {
    id: "sales",
    label: "Sales",
    groups: ["Funnel", "Quotations & Tax", "Products", "Projects", "Sales Orders"],
  },
  {
    id: "finance",
    label: "Finance & Insights",
    groups: ["Billing & Purchasing", "Forecast", "Intercompany"],
  },
  {
    id: "admin",
    label: "Administration",
    groups: ["Record access", "Administration", "Audit", "Documentation"],
  },
]

type Group = (typeof PERMISSION_GROUPS)[number]

function areaGroups(areaId: string): Group[] {
  const area = AREAS.find((a) => a.id === areaId)!
  const inArea = PERMISSION_GROUPS.filter((g) => area.groups.includes(g.group))
  // Anything the AREAS map missed lands in Administration so nothing is hidden.
  if (areaId === "admin") {
    const known = new Set(AREAS.flatMap((a) => a.groups))
    return [...inArea, ...PERMISSION_GROUPS.filter((g) => !known.has(g.group))]
  }
  return inArea
}

// Only areas that actually have visible permission groups. Areas whose every
// group is gated off by a disabled plugin (e.g. "Finance & Insights" in the
// Core Edition) drop out entirely rather than showing an empty tab.
const VISIBLE_AREAS = AREAS.filter((a) => areaGroups(a.id).length > 0)

export function RolesManager({
  roles,
  admins,
  initialRoleId,
}: {
  roles: RoleWithPermissions[]
  admins: PermissionAdmin[]
  initialRoleId?: string
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = React.useState(
    (initialRoleId && roles.some((r) => r.id === initialRoleId)
      ? initialRoleId
      : roles[0]?.id) ?? ""
  )
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0]

  const [checked, setChecked] = React.useState<Set<string>>(
    () => new Set(selected?.permissions ?? [])
  )
  const [area, setArea] = React.useState(VISIBLE_AREAS[0]?.id ?? "crm")
  const [saving, setSaving] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  // Reset the working set whenever the selected role changes
  // (adjust-during-render — no effect, matches the app's set-state convention).
  const [lastSelectedId, setLastSelectedId] = React.useState(selectedId)
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId)
    setChecked(new Set(selected?.permissions ?? []))
  }

  const baseline = React.useMemo(
    () => [...(selected?.permissions ?? [])].sort().join(","),
    [selected]
  )
  const dirty = [...checked].sort().join(",") !== baseline

  function toggle(key: string, on: boolean | "indeterminate") {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }
  function toggleGroup(keys: string[], on: boolean | "indeterminate") {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  async function onSave() {
    if (!selected) return
    setSaving(true)
    const res = await setRolePermissions(selected.id, [...checked])
    setSaving(false)
    if (!res.ok) return showActionError(res)
    toast.success(`${selected.name} permissions saved`)
    router.refresh()
  }

  if (!selected) return null

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      {/* Role list */}
      <div className="grid h-fit gap-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {roles.length} role{roles.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New role
          </Button>
        </div>
        <div className="grid gap-1.5">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                r.id === selectedId && "border-primary/40 bg-accent"
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                {r.name}
                {r.isSystem ? (
                  <Badge variant="outline" className="font-normal">
                    System
                  </Badge>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3" />
                  {r.memberCount}
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3" />
                  {r.permissionCount} perms
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Selected role — permission grid */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="grid gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              {selected.name}
              {selected.isSystem ? (
                <Badge variant="outline" className="font-normal">
                  System
                </Badge>
              ) : null}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {selected.description ??
                (selected.isSystem ? "Built-in role" : "Custom role")}{" "}
              · {selected.memberCount} member
              {selected.memberCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" />
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={selected.isSystem}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button onClick={onSave} disabled={!dirty || saving}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {admins.length > 0 ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <span className="font-medium">Who can change permissions:</span>{" "}
              <span className="text-muted-foreground">
                only members with the “Manage roles” permission —{" "}
                {admins.map((a, i) => (
                  <span key={a.memberId}>
                    {i > 0 ? ", " : ""}
                    <span className="font-medium text-foreground">{a.name}</span>{" "}
                    ({a.roleNames.join(", ")})
                  </span>
                ))}
                .
              </span>
            </div>
          ) : null}
          <Tabs value={area} onValueChange={setArea}>
            <TabsList className="h-auto flex-wrap justify-start gap-1 *:flex-none">
              {VISIBLE_AREAS.map((a) => (
                <TabsTrigger key={a.id} value={a.id}>
                  {a.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {VISIBLE_AREAS.map((a) => (
              <TabsContent key={a.id} value={a.id} className="mt-4 grid gap-3">
                {areaGroups(a.id).map((group) => {
                  const keys = group.items.map((i) => i.key)
                  const allOn = keys.every((k) => checked.has(k))
                  const someOn = keys.some((k) => checked.has(k))
                  return (
                    <div key={group.group} className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold">{group.group}</span>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={allOn}
                            indeterminate={!allOn && someOn}
                            onCheckedChange={(v) => toggleGroup(keys, v)}
                          />
                          Select all
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.items.map((item) => (
                          <label
                            key={item.key}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={checked.has(item.key)}
                              onCheckedChange={(v) => toggle(item.key, v)}
                            />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {areaGroups(a.id).length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No permissions in this area (its module may be disabled).
                  </p>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <RoleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={() => router.refresh()}
      />
      <RoleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        role={selected}
        onDone={() => router.refresh()}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selected.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the role. Roles assigned to a member can’t
              be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                const res = await deleteRole(selected.id)
                setConfirmDelete(false)
                if (!res.ok) return showActionError(res)
                toast.success("Role deleted")
                setSelectedId(roles[0]?.id ?? "")
                router.refresh()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RoleFormDialog({
  open,
  onOpenChange,
  role,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  role?: RoleWithPermissions
  onDone: () => void
}) {
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  // Reset to the role's name each time the dialog opens (adjust-during-render).
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(role?.name ?? "")
  }

  async function submit() {
    setBusy(true)
    const res = role
      ? await updateRole(role.id, { name: name.trim() })
      : await createRole({ name: name.trim() })
    setBusy(false)
    if (!res.ok) return showActionError(res)
    toast.success(role ? "Role updated" : "Role created")
    onOpenChange(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? "Rename role" : "New role"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales Manager"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Choose what this role can do from the permission grid below. A
              member&apos;s access is the union of all the roles they hold.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : role ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
