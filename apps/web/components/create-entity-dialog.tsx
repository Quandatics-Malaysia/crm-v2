"use client"

import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createEntity } from "@/app/(app)/_shared/entity-actions"
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

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addPeriod(start: string, months: number, days = 0) {
  const date = new Date(`${start}T00:00:00Z`)
  if (months) date.setUTCMonth(date.getUTCMonth() + months)
  if (days) date.setUTCDate(date.getUTCDate() + days - 1)
  else date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

type Invite = { id: string; email: string; roleName: string }

export function CreateEntityDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const initialDate = today()
  const [name, setName] = React.useState("")
  const [entityCode, setEntityCode] = React.useState("")
  const [plan, setPlan] = React.useState("Starter")
  const [seats, setSeats] = React.useState("1")
  const [startsAt, setStartsAt] = React.useState(initialDate)
  const [endsAt, setEndsAt] = React.useState(addPeriod(initialDate, 1))
  const [invites, setInvites] = React.useState<Invite[]>([])
  const [busy, setBusy] = React.useState(false)

  function updateInvite(id: string, patch: Partial<Invite>) {
    setInvites((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function reset() {
    const start = today()
    setName("")
    setEntityCode("")
    setPlan("Starter")
    setSeats("1")
    setStartsAt(start)
    setEndsAt(addPeriod(start, 1))
    setInvites([])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const seatCount = Number(seats)
    if (!name.trim() || !Number.isInteger(seatCount) || seatCount < 1) return
    setBusy(true)
    try {
      await createEntity({
        name: name.trim(),
        entityCode: entityCode.trim() || undefined,
        plan,
        seats: seatCount,
        startsAt,
        endsAt,
        invites: invites.map(({ email, roleName }) => ({ email, roleName })),
      })
      toast.success(`${name.trim()} created with ${seatCount} seats`)
      onOpenChange(false)
      reset()
      router.push("/dashboard")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create organization")
    } finally {
      setBusy(false)
    }
  }

  const seatCount = Number(seats)
  const invalid = !name.trim() || !plan.trim() || !Number.isInteger(seatCount) ||
    seatCount < 1 || !startsAt || !endsAt || startsAt > endsAt || invites.length > seatCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create customer organization</DialogTitle>
          <DialogDescription>
            Set its licence and prepare its first users in one step. Invited users receive their selected seeded role when they sign in.
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

          <section className="grid gap-3 rounded-lg border p-4">
            <div><h3 className="text-sm font-medium">Access licence</h3><p className="text-xs text-muted-foreground">Seats become usable immediately on the chosen start date and stop after the end date.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-2"><Label htmlFor="ent-plan">Plan</Label><Input id="ent-plan" value={plan} onChange={(event) => setPlan(event.target.value)} /></div>
              <div className="grid gap-2"><Label htmlFor="ent-seats">Customer seats</Label><Input id="ent-seats" type="number" min="1" step="1" value={seats} onChange={(event) => setSeats(event.target.value)} /></div>
              <div className="grid gap-2"><Label htmlFor="ent-start">Valid from</Label><Input id="ent-start" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div>
              <div className="grid gap-2"><Label htmlFor="ent-end">Valid until</Label><Input id="ent-end" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Set period:</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setEndsAt(addPeriod(startsAt || today(), 0, 30))}>30 days</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEndsAt(addPeriod(startsAt || today(), 6))}>6 months</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEndsAt(addPeriod(startsAt || today(), 12))}>1 year</Button>
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
            {invites.length > seatCount ? <p className="text-sm text-destructive">Issue at least {invites.length} seats for these users.</p> : null}
          </section>
        </form>
        <DialogFooter>
          <Button type="submit" form="create-entity-form" disabled={busy || invalid}>{busy ? "Creating…" : "Create and issue access"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CreateFirstEntity() {
  const [open, setOpen] = React.useState(false)
  return <><Button onClick={() => setOpen(true)}><PlusIcon className="size-4" /> Create customer organization</Button><CreateEntityDialog open={open} onOpenChange={setOpen} /></>
}
