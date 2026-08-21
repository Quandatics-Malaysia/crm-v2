"use client"

import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createEntity } from "@/app/(app)/_shared/entity-actions"
import { showActionError } from "@/lib/show-action-error"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const INITIAL_ROLES = [
  ["Owner", "Full workspace control"],
  ["Admin", "Users, roles, settings and all business modules"],
  ["Developer", "Business modules and internal docs; no tenant administration"],
  ["Manager", "Team operations, approvals and commercial controls"],
  ["Senior Rep", "Sales work with senior approval rights"],
  ["Rep", "Day-to-day sales work"],
  ["Viewer", "Read-only workspace access"],
] as const

type Invite = { id: string; email: string; roleName: string }

export function CreateEntityDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [entityCode, setEntityCode] = React.useState("")
  const [invites, setInvites] = React.useState<Invite[]>([])
  const [busy, setBusy] = React.useState(false)

  function updateInvite(id: string, patch: Partial<Invite>) {
    setInvites((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function reset() {
    setName("")
    setEntityCode("")
    setInvites([])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const result = await createEntity({
        name: name.trim(),
        entityCode: entityCode.trim() || undefined,
        invites: invites.map(({ email, roleName }) => ({ email, roleName })),
      })
      if (!result.ok) {
        showActionError(result)
        return
      }
      toast.success(`${name.trim()} created`)
      onOpenChange(false)
      reset()
      router.push("/dashboard")
      router.refresh()
    } catch {
      toast.error("We couldn’t create the organization. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const invalid = !name.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create customer organization</DialogTitle>
          <DialogDescription>
            Prepare customer organization and initial users. Commercial seats,
            contract dates, and modules come from vendor-issued entitlement.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-6" id="create-entity-form">
          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Organization</h3>
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <div className="grid gap-2"><Label htmlFor="ent-name">Customer name</Label><Input id="ent-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Citrus Cloud" autoFocus /></div>
              <div className="grid gap-2"><Label htmlFor="ent-code">Code</Label><Input id="ent-code" value={entityCode} onChange={(event) => setEntityCode(event.target.value.toUpperCase())} placeholder="CC" maxLength={8} className="uppercase" /></div>
            </div>
          </section>

          <section className="grid gap-3">
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-sm font-medium">Initial users</h3><p className="text-xs text-muted-foreground">Optional. Add who should join and select their role.</p></div>
              <Button type="button" size="sm" variant="outline" onClick={() => setInvites((rows) => [...rows, { id: crypto.randomUUID(), email: "", roleName: "Owner" }])}><PlusIcon className="size-4" /> Add user</Button>
            </div>
            {invites.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No customer users yet. You can invite them later from Team &amp; roles.</div> : invites.map((invite) => (
              <div key={invite.id} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_15rem_auto]">
                <div className="grid gap-2"><Label htmlFor={`invite-${invite.id}`}>Email</Label><Input id={`invite-${invite.id}`} type="email" value={invite.email} onChange={(event) => updateInvite(invite.id, { email: event.target.value })} placeholder="owner@customer.com" /></div>
                <div className="grid gap-2"><Label>Role and permissions</Label><Select value={invite.roleName} onValueChange={(value) => updateInvite(invite.id, { roleName: value ?? "Owner" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{INITIAL_ROLES.map(([role, description]) => <SelectItem key={role} value={role}><div><div>{role}</div><div className="text-xs text-muted-foreground">{description}</div></div></SelectItem>)}</SelectContent></Select></div>
                <Button type="button" size="icon" variant="ghost" aria-label="Remove user" onClick={() => setInvites((rows) => rows.filter((row) => row.id !== invite.id))}><Trash2Icon className="size-4" /></Button>
              </div>
            ))}
          </section>
        </form>
        <DialogFooter>
          <Button type="submit" form="create-entity-form" disabled={busy || invalid}>{busy ? "Creating…" : "Create organization"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CreateFirstEntity() {
  const [open, setOpen] = React.useState(false)
  return <><Button onClick={() => setOpen(true)}><PlusIcon className="size-4" /> Create customer organization</Button><CreateEntityDialog open={open} onOpenChange={setOpen} /></>
}
