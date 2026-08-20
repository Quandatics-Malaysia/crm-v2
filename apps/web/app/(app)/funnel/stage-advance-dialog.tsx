"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { showActionError } from "@/lib/show-action-error"

import {
  missingFromKeys,
  requiresCloseRemarks,
  closeRemarksLabel,
  stagesRequiredBefore,
  requiredKeysForStages,
  isRollbackTransition,
  type StageGate,
  type CustomFunnelField,
} from "@/lib/stage-gate"

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
import { AttachmentUpload } from "@/components/attachments/attachment-upload"
import { formatPercent } from "@/lib/format"
import type { PpvvcPatch } from "@/lib/ppvvc"
import { StageBadge } from "./stage-badge"
import { advanceStageAction } from "./actions"
import { selectableTargets } from "./stage-transitions"

// Where each Opportunity-level preset gate field is edited, so a blocked move
// can deep-link straight to it. Keys absent here live on the Funnel's own
// Details panel (procurementStage, negotiationDate, estimate, contact, …).
const OPP_ANALYSIS_KEYS = new Set([
  "vision",
  "objective",
  "value",
  "powerSponsorContact",
  "powerSponsorBudgetLimit",
  "oppEstimatedBudget",
  "oppEstimatedCloseDate",
])
const OPP_DETAILS_KEYS = new Set(["ownerContact", "ownerBudgetLimit"])

type Stage = {
  id: string
  code: string
  name: string
  kind: string
  probability: string
  sortOrder: number
  requiresApprovalToEnter: boolean
  /** Configurable entry requirements (field keys) for this stage. */
  requiredFields: string[]
}

export function StageAdvanceDialog({
  funnelId,
  currentStageId,
  stages,
  trigger,
  open: openProp,
  onOpenChange,
  initialTargetStageId,
  gate,
  opportunityId,
  opportunityName,
  skipPpvvc = false,
}: {
  funnelId: string
  currentStageId: string
  stages: Stage[]
  trigger?: React.ReactElement
  /** Controlled open state. When provided, the dialog can be driven externally
   * (e.g. opened by the funnel board after a gated drag-drop). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Pre-select a target stage when the dialog opens (controlled usage). */
  initialTargetStageId?: string
  /** Resolved per-stage entry gate (preset + custom field completeness). */
  gate?: StageGate
  /** Tenant custom-field definitions, so required fields can be filled inline. */
  customFieldDefs?: CustomFunnelField[]
  /** The funnel's current custom-field values (prefill the inputs). */
  customValues?: Record<string, string>
  /** Parent Opportunity container — preset fields (Vision, Owner Contact, …)
   * live there, not on this Funnel, so a blocked move needs a way there. */
  opportunityId?: string
  opportunityName?: string
  /** Authoritative Opportunity PPVVC values, shown inline for gated moves. */
  ppvvc?: PpvvcPatch | null
  canEditPpvvc?: boolean
  skipPpvvc?: boolean
}) {
  const router = useRouter()
  const [openState, setOpenState] = React.useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : openState
  const setOpen = React.useCallback(
    (o: boolean) => {
      if (!isControlled) setOpenState(o)
      onOpenChange?.(o)
    },
    [isControlled, onOpenChange]
  )
  // Seed the target from a controlled pre-selection (e.g. the board opens this
  // dialog, freshly keyed per gated drop, with a chosen target stage).
  const [targetStageId, setTargetStageId] = React.useState(
    initialTargetStageId ?? ""
  )
  const [reason, setReason] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [approvalRequestId, setApprovalRequestId] = React.useState<
    string | null
  >(null)
  const ordered = React.useMemo(
    () => [...stages].sort((a, b) => a.sortOrder - b.sortOrder),
    [stages]
  )
  // Only stages the server's state machine will actually accept as a move.
  const selectable = selectableTargets(ordered, currentStageId)
  const target = ordered.find((s) => s.id === targetStageId)
  const from = ordered.find((s) => s.id === currentStageId)
  const rollback = !!from && !!target && isRollbackTransition(from, target)
  const needsApproval = !rollback && (target?.requiresApprovalToEnter ?? false)

  // Advancing to a stage checks every earlier stage, including the current one.
  const requiredStages = React.useMemo(
    () => (target ? stagesRequiredBefore(ordered, currentStageId, target.id) : []),
    [ordered, currentStageId, target]
  )
  const requiredKeys = React.useMemo(
    () =>
      requiredKeysForStages(requiredStages, {
        skipPpvvcForWonTransition: skipPpvvc || target?.kind === "WON",
      }),
    [requiredStages, skipPpvvc, target?.kind]
  )
  const missing = missingFromKeys(
    requiredKeys,
    gate ?? { satisfied: {}, labels: {} }
  )
  const isTerminal = target ? requiresCloseRemarks(target.kind) : false
  // Only terminal (Lost/KIV) moves require a written reason; approval context is optional.
  const needsReason = !rollback && isTerminal
  const showReason = !rollback && (needsApproval || isTerminal)
  const blocked = missing.length > 0 || (needsReason && !reason.trim())

  const stageLabel = React.useCallback(
    (s: Stage) => `${s.code} — ${s.name} · ${formatPercent(s.probability)}`,
    []
  )
  const stageItems = React.useMemo(
    () => selectable.map((s) => ({ value: s.id, label: stageLabel(s) })),
    [selectable, stageLabel]
  )

  function reset() {
    setTargetStageId("")
    setReason("")
    setApprovalRequestId(null)
    setSubmitting(false)
  }

  async function onSubmit() {
    if (!targetStageId) {
      toast.error("Pick a target stage")
      return
    }
    if (missing.length > 0) {
      toast.error(`${missing.length} required field${missing.length > 1 ? "s" : ""} still missing`, {
        description: "See the checklist in this dialog for where to fill each one in.",
      })
      return
    }
    if (needsReason && !reason.trim()) {
      toast.error(
        isTerminal ? "Close remarks are required" : "A reason is required for this stage"
      )
      return
    }
    setSubmitting(true)
    try {
      const res = await advanceStageAction({
        funnelId,
        targetStageId,
        reason: reason.trim() || undefined,
        skipPpvvc,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      const result = res.data
      if (result.moved) {
        // Moved immediately — there's no approval request to attach to.
        toast.success(rollback ? "Stage moved back" : "Stage advanced")
        setOpen(false)
        reset()
        router.refresh()
      } else {
        toast.success("Sent for approval")
        // Keep the dialog open so the requester can attach more files.
        if (result.approvalRequestId) {
          setApprovalRequestId(result.approvalRequestId)
        } else {
          setOpen(false)
          reset()
        }
        router.refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not advance stage")
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
      {isControlled && !trigger ? null : (
        <DialogTrigger render={trigger ?? <Button>Advance stage</Button>} />
      )}
      <DialogContent className="w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rollback ? "Move back" : "Advance stage"}</DialogTitle>
          <DialogDescription>
            {rollback
              ? "Move this Funnel back without re-entering stage requirements."
              : "Move this Funnel to a new stage. Some stages require manager approval before the move takes effect."}
          </DialogDescription>
        </DialogHeader>

        {approvalRequestId ? (
          <div className="grid gap-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              Your request is pending approval. You can attach supporting
              documents below, or manage it from{" "}
              <Link href="/approvals" className="font-medium underline">
                Approvals
              </Link>
              .
            </div>
            <div className="grid gap-2">
              <Label>Attachments</Label>
              <AttachmentUpload
                attachableType="stage_approval_request"
                attachableId={approvalRequestId}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Target stage</Label>
              <Select
                value={targetStageId}
                onValueChange={(v) => setTargetStageId((v as string) ?? "")}
                items={stageItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a stage…" />
                </SelectTrigger>
                <SelectContent>
                  {selectable.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {stageLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {target ? (
                <div className="pt-1">
                  <StageBadge
                    name={target.name}
                    kind={target.kind}
                    probability={target.probability}
                  />
                </div>
              ) : null}
            </div>

            {!rollback && target && missing.length > 0 ? (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="font-medium">Complete earlier-stage fields first</p>
                <ul className="mt-2 grid gap-1.5">
                  {missing.map((m) => {
                    const onAnalysis = OPP_ANALYSIS_KEYS.has(m.key)
                    const onDetails = OPP_DETAILS_KEYS.has(m.key)
                    const href =
                      opportunityId && (onAnalysis || onDetails)
                        ? `/opportunities/${opportunityId}${onAnalysis ? "?tab=analysis" : ""}`
                        : null
                    return (
                      <li key={m.key} className="flex flex-wrap items-baseline gap-x-1.5">
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-amber-500"
                        />
                        <span>{m.label}</span>
                        {href ? (
                          <Link
                            href={href}
                            target="_blank"
                            className="text-xs font-medium underline"
                          >
                            fill in on {opportunityName ?? "the Opportunity"} ↗
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            — on this Funnel&apos;s Details panel
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Fill these in on the Funnel or Opportunity details, then come back and advance.
                </p>
              </div>
            ) : null}

            {showReason ? (
              <div className="grid gap-2">
                <Label htmlFor="advance-reason">
                  {isTerminal && target
                    ? closeRemarksLabel(target.kind)
                    : "Reason (optional)"}{" "}
                  {isTerminal ? <span className="text-destructive">*</span> : null}
                </Label>
                <Textarea
                  id="advance-reason"
                  placeholder={
                    isTerminal
                      ? "Why is this funnel being closed? (recorded on the stage history)"
                    : "Add context for the approver (optional)"
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  {isTerminal
                    ? "Close remarks are kept on the funnel's stage history."
                    : "This stage requires approval. Your request is routed to an approver — track its status under Approvals."}
                </p>
              </div>
            ) : null}

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
              <Button
                type="button"
                onClick={onSubmit}
                disabled={submitting || blocked}
              >
                {rollback ? "Move back" : needsApproval ? "Request advance" : "Advance"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
