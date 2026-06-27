"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, X, Ban, ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { formatDate } from "@/lib/format"
import { AttachmentList } from "@/components/attachments/attachment-upload"
import {
  listEntityAttachments,
  type AttachmentRow,
} from "@/app/(app)/_shared/attachment-actions"
import { decideApprovalAction, type ApprovalRow } from "./actions"

const STATUS_VARIANT: Record<
  ApprovalRow["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
}

function StatusBadge({ status }: { status: ApprovalRow["status"] }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className="capitalize">
      {status}
    </Badge>
  )
}

function Attachments({ requestId }: { requestId: string }) {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<AttachmentRow[] | null>(null)
  const [loading, setLoading] = React.useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && items === null) {
      setLoading(true)
      try {
        const data = await listEntityAttachments("stage_approval_request", requestId)
        setItems(data)
      } catch {
        setItems([])
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />
        Attachments
      </button>
      {open ? (
        <div className="mt-2 pl-1">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </span>
          ) : (
            <AttachmentList items={items ?? []} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function StagePath({ row }: { row: ApprovalRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{row.fromStageName ?? "—"}</span>
      <ChevronRight className="size-3.5 text-muted-foreground" />
      <span className="font-medium">{row.targetStageName}</span>
    </span>
  )
}

function DecisionDialog({
  row,
  decision,
  onDone,
}: {
  row: ApprovalRow
  decision: "approved" | "rejected"
  onDone: () => void
}) {
  const [note, setNote] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const approve = decision === "approved"

  function submit() {
    startTransition(async () => {
      const res = await decideApprovalAction({
        requestId: row.id,
        decision,
        note: note.trim() || undefined,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(approve ? "Request approved" : "Request rejected")
      onDone()
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant={approve ? "default" : "outline"}>
            {approve ? <Check className="size-4" /> : <X className="size-4" />}
            {approve ? "Approve" : "Reject"}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {approve ? "Approve stage advance" : "Reject stage advance"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {row.opportunityName} — moving to {row.targetStageName}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`note-${row.id}-${decision}`}>Note (optional)</Label>
          <Textarea
            id={`note-${row.id}-${decision}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a decision note…"
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={approve ? "default" : "destructive"}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {approve ? "Approve" : "Reject"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CancelDialog({ row, onDone }: { row: ApprovalRow; onDone: () => void }) {
  const [pending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const res = await decideApprovalAction({
        requestId: row.id,
        decision: "cancelled",
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Request cancelled")
      onDone()
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Ban className="size-4" />
            Cancel
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
          <AlertDialogDescription>
            {row.opportunityName} will stay in its current stage. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Cancel request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function IncomingCard({ row, onDone }: { row: ApprovalRow; onDone: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <span className="font-medium">{row.opportunityName}</span>
            <StagePath row={row} />
          </div>
          <StatusBadge status={row.status} />
        </div>
        <p className="text-sm text-muted-foreground">{row.reason}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Requested by{" "}
            <span className="text-foreground">{row.requesterName ?? "Unknown"}</span>
          </span>
          <span>{formatDate(row.requestedAt)}</span>
        </div>
        <Attachments requestId={row.id} />
        <Separator />
        <div className="flex items-center justify-end gap-2">
          <DecisionDialog row={row} decision="rejected" onDone={onDone} />
          <DecisionDialog row={row} decision="approved" onDone={onDone} />
        </div>
      </CardContent>
    </Card>
  )
}

function MineCard({ row, onDone }: { row: ApprovalRow; onDone: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <span className="font-medium">{row.opportunityName}</span>
            <StagePath row={row} />
          </div>
          <StatusBadge status={row.status} />
        </div>
        <p className="text-sm text-muted-foreground">{row.reason}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {row.approverName ? (
            <span>
              Approver{" "}
              <span className="text-foreground">{row.approverName}</span>
            </span>
          ) : (
            <span>Unrouted</span>
          )}
          <span>Requested {formatDate(row.requestedAt)}</span>
          {row.decidedAt ? <span>Decided {formatDate(row.decidedAt)}</span> : null}
        </div>
        {row.decisionNote ? (
          <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
            Note: {row.decisionNote}
          </p>
        ) : null}
        <Attachments requestId={row.id} />
        {row.status === "pending" ? (
          <>
            <Separator />
            <div className="flex items-center justify-end">
              <CancelDialog row={row} onDone={onDone} />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ApprovalsClient({
  incoming,
  mine,
}: {
  incoming: ApprovalRow[]
  mine: ApprovalRow[]
}) {
  const router = useRouter()
  const refresh = React.useCallback(() => router.refresh(), [router])

  return (
    <Tabs defaultValue="incoming" className="w-full">
      <TabsList>
        <TabsTrigger value="incoming">Incoming ({incoming.length})</TabsTrigger>
        <TabsTrigger value="mine">My requests ({mine.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="incoming" className="mt-4">
        {incoming.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No pending approvals routed to you.
          </p>
        ) : (
          <div className="grid gap-3">
            {incoming.map((row) => (
              <IncomingCard key={row.id} row={row} onDone={refresh} />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="mine" className="mt-4">
        {mine.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            You haven&apos;t requested any approvals.
          </p>
        ) : (
          <div className="grid gap-3">
            {mine.map((row) => (
              <MineCard key={row.id} row={row} onDone={refresh} />
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
