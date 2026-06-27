"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createEntity } from "@/app/(app)/_shared/entity-actions"

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
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await createEntity({
        name: name.trim(),
        entityCode: entityCode.trim() || undefined,
      })
      toast.success("Organization created")
      onOpenChange(false)
      setName("")
      setEntityCode("")
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create organization"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            A new organization with its own data, roles, funnel, and numbering.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" id="create-entity-form">
          <div className="grid gap-2">
            <Label htmlFor="ent-name">Name</Label>
            <Input
              id="ent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Citrus Cloud"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ent-code">Organization code</Label>
            <Input
              id="ent-code"
              value={entityCode}
              onChange={(e) => setEntityCode(e.target.value.toUpperCase())}
              placeholder="CC"
              maxLength={8}
              className="uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Used in project &amp; SO codes (e.g. CC → CCSO-0001).
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="create-entity-form" disabled={busy}>
            {busy ? "Creating…" : "Create organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
