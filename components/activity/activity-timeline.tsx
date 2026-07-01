"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  StickyNoteIcon,
  PhoneIcon,
  CalendarIcon,
  MailIcon,
  ActivityIcon,
  ArrowRightIcon,
  PaperclipIcon,
  PlusIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { addActivity, type ActivityRow } from "@/app/(app)/_shared/activity-actions"
import type { ActivityEntity, ActivityKind } from "@/server/services/activity"
import { formatDate } from "@/lib/format"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  note: StickyNoteIcon,
  call: PhoneIcon,
  meeting: CalendarIcon,
  email: MailIcon,
  system: ActivityIcon,
  stage_change: ArrowRightIcon,
  file: PaperclipIcon,
}

const TYPES: { value: ActivityKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
]

const TYPE_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  system: "System",
  stage_change: "Stage change",
  file: "File",
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/** Standardized activity logger + timeline. Every manual entry captures the
 *  same fields: type, date, subject, details, outcome, and next step. */
export function ActivityTimeline({
  entityType,
  entityId,
  items,
  revalidate,
}: {
  entityType: ActivityEntity
  entityId: string
  items: ActivityRow[]
  revalidate?: string
}) {
  const router = useRouter()
  const [type, setType] = React.useState<ActivityKind>("note")
  const [occurredAt, setOccurredAt] = React.useState(todayISO())
  const [subject, setSubject] = React.useState("")
  const [body, setBody] = React.useState("")
  const [outcome, setOutcome] = React.useState("")
  const [nextStep, setNextStep] = React.useState("")
  const [dueAt, setDueAt] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [showAll, setShowAll] = React.useState(false)
  // The composer is collapsed by default so the timeline reads cleanly; the
  // "Log activity" button reveals the full form on demand.
  const [composerOpen, setComposerOpen] = React.useState(false)

  const VISIBLE = 4
  const visible = showAll ? items : items.slice(0, VISIBLE)

  function reset() {
    setType("note")
    setOccurredAt(todayISO())
    setSubject("")
    setBody("")
    setOutcome("")
    setNextStep("")
    setDueAt("")
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) {
      toast.error("Add a subject for the log entry")
      return
    }
    setBusy(true)
    try {
      const res = await addActivity({
        entityType,
        entityId,
        type,
        subject: subject.trim(),
        body: body.trim() || undefined,
        outcome: outcome.trim() || undefined,
        nextStep: nextStep.trim() || undefined,
        occurredAt,
        dueAt: dueAt || undefined,
        revalidate,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      reset()
      setComposerOpen(false)
      toast.success("Activity logged")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {!composerOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setComposerOpen(true)}
        >
          <PlusIcon className="size-4" />
          Log activity
        </Button>
      ) : (
      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType((v as ActivityKind) ?? "note")}
              items={TYPES}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Subject</Label>
          <Input
            placeholder="e.g. Intro call with procurement"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Details</Label>
          <Textarea
            placeholder="What was discussed…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Outcome</Label>
            <Input
              placeholder="Result / decision"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Next step</Label>
            <Input
              placeholder="Follow-up action"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Follow-up date</Label>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                reset()
                setComposerOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              Log activity
            </Button>
          </div>
        </div>
      </form>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="grid gap-3">
          {visible.map((a) => {
            const Icon = ICONS[a.type] ?? ActivityIcon
            return (
              <li key={a.id} className="flex gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted">
                  <Icon className="size-3.5" />
                </div>
                <div className="grid gap-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {TYPE_LABEL[a.type] ?? a.type}
                    </span>
                    {a.subject ?? ""}
                  </div>
                  {a.body ? (
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {a.body}
                    </div>
                  ) : null}
                  {a.outcome ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Outcome:</span>{" "}
                      {a.outcome}
                    </div>
                  ) : null}
                  {a.nextStep ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Next:</span>{" "}
                      {a.nextStep}
                      {a.dueAt ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (by {formatDate(a.dueAt)})
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {a.memberName ?? "System"} · {formatDate(a.occurredAt)}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {items.length > VISIBLE ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {showAll ? "Show less" : `Show ${items.length - VISIBLE} more`}
        </button>
      ) : null}
    </div>
  )
}
