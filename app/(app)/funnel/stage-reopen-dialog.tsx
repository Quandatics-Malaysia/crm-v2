"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { formatPercent } from "@/lib/format"
import { reopenStageAction } from "./actions"

type Stage = {
  id: string
  code: string
  name: string
  kind: string
  probability: string
  sortOrder: number
}

/**
 * Reopen a parked (KIV) or lost opportunity back into an OPEN stage. Only the
 * funnel's OPEN stages are offered as targets; the server clears closedAt and
 * resets status to open.
 */
export function StageReopenDialog({
  opportunityId,
  stages,
  trigger,
}: {
  opportunityId: string
  stages: Stage[]
  trigger?: React.ReactElement
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [targetStageId, setTargetStageId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const openStages = React.useMemo(
    () =>
      [...stages]
        .filter((s) => s.kind === "OPEN")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [stages]
  )

  const stageLabel = React.useCallback(
    (s: Stage) => `${s.code} — ${s.name} · ${formatPercent(s.probability)}`,
    []
  )
  const stageItems = React.useMemo(
    () => openStages.map((s) => ({ value: s.id, label: stageLabel(s) })),
    [openStages, stageLabel]
  )

  function reset() {
    setTargetStageId("")
    setReason("")
    setSubmitting(false)
  }

  async function onSubmit() {
    if (!targetStageId) {
      toast.error("Pick a stage to reopen into")
      return
    }
    setSubmitting(true)
    try {
      const res = await reopenStageAction({
        opportunityId,
        targetStageId,
        reason: reason.trim() || undefined,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Opportunity reopened")
      setOpen(false)
      reset()
      router.refresh()
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not reopen the opportunity"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger render={trigger ?? <Button variant="outline">Reopen</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen opportunity</DialogTitle>
          <DialogDescription>
            Move this closed opportunity back into an open stage. Its close date
            is cleared and the status returns to open.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Reopen into stage</Label>
            <Select
              value={targetStageId}
              onValueChange={(v) => setTargetStageId((v as string) ?? "")}
              items={stageItems}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick an open stage…" />
              </SelectTrigger>
              <SelectContent>
                {openStages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {stageLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reopen-reason">Reason (optional)</Label>
            <Textarea
              id="reopen-reason"
              placeholder="Why is this being reopened?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={submitting}>
              Reopen
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
