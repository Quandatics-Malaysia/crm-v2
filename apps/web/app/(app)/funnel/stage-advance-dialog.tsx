"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HelpCircleIcon } from "lucide-react"
import { showActionError } from "@/lib/show-action-error"

import {
  missingFromKeys,
  requiresCloseRemarks,
  closeRemarksLabel,
  stagesEnteredBy,
  requiredKeysForStages,
  groupCustomFields,
  isPresetFieldKey,
  type StageGate,
  type CustomFunnelField,
} from "@/lib/stage-gate"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
import { Input } from "@/components/ui/input"
import { FileDropzone } from "@/components/file-dropzone"
import { Checkbox } from "@/components/ui/checkbox"
import { AttachmentUpload } from "@/components/attachments/attachment-upload"
import { uploadEntityAttachment } from "@/app/(app)/_shared/attachment-actions"
import { formatPercent } from "@/lib/format"
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
  customFieldDefs = [],
  customValues = {},
  opportunityId,
  opportunityName,
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
  const [file, setFile] = React.useState<File | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [approvalRequestId, setApprovalRequestId] = React.useState<
    string | null
  >(null)
  // Live edits to the required custom fields, merged over the funnel's stored
  // values when the gate is evaluated and sent with the advance.
  const [values, setValues] = React.useState<Record<string, string>>({})

  const ordered = React.useMemo(
    () => [...stages].sort((a, b) => a.sortOrder - b.sortOrder),
    [stages]
  )
  // Only stages the server's state machine will actually accept as a move.
  const selectable = selectableTargets(ordered, currentStageId)
  const target = ordered.find((s) => s.id === targetStageId)
  const needsApproval = target?.requiresApprovalToEnter ?? false

  // Merge the dialog's live edits over the funnel's stored custom values.
  const merged = React.useMemo(
    () => ({ ...customValues, ...values }),
    [customValues, values]
  )
  // A multi-stage jump must satisfy every stage it passes through, so collect
  // the union of required keys across all stages this move enters (0e→4a pulls
  // in 1d/2c/3b too).
  const enteredStages = React.useMemo(
    () => (target ? stagesEnteredBy(ordered, currentStageId, target.id) : []),
    [ordered, currentStageId, target]
  )
  const requiredKeys = React.useMemo(
    () =>
      requiredKeysForStages(enteredStages, {
        skipPpvvcForWonTransition: target?.kind === "WON",
      }),
    [enteredStages]
  )
  // Live gate: keep the server-computed presets, but recompute the custom keys
  // from the merged values so the checklist/blocked state update as you type.
  const liveGate = React.useMemo<StageGate>(() => {
    const satisfied = { ...(gate?.satisfied ?? {}) }
    const labels = { ...(gate?.labels ?? {}) }
    for (const f of customFieldDefs) {
      const s = (merged[f.key] ?? "").trim()
      satisfied[f.key] = f.type === "checkbox" ? s === "true" : s !== ""
      labels[f.key] = f.label
    }
    return { satisfied, labels }
  }, [gate, customFieldDefs, merged])

  const defByKey = React.useMemo(
    () => new Map(customFieldDefs.map((f) => [f.key, f])),
    [customFieldDefs]
  )
  // Tenant custom-field requirements get an inline fill-in-here input; preset
  // requirements (Vision, Opportunity Owner Contact, …) are edited on the
  // Opportunity/Funnel record itself, not in this dialog — so they're excluded
  // from `collectFields` (what's rendered) but NOT from `missing` (what blocks
  // the Advance button) — otherwise the button would look clear while the
  // server still rejects the move.
  const collectFields = requiredKeys
    .map((k) => defByKey.get(k))
    .filter((f): f is CustomFunnelField => !!f)
  const missing = missingFromKeys(requiredKeys, liveGate)
  // Preset fields can't be filled in this dialog (unlike tenant custom fields,
  // which get inline inputs above) — the checklist points at where each lives:
  // the parent Opportunity's Analysis tab / Details card, or this Funnel's own
  // Details panel.
  const missingPresets = missing.filter((m) => isPresetFieldKey(m.key))
  const isTerminal = target ? requiresCloseRemarks(target.kind) : false
  // A written reason is required for approval-gated AND terminal (Lost/KIV) moves.
  const needsReason = needsApproval || isTerminal
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
    setFile(null)
    setValues({})
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
        customFields: Object.keys(values).length > 0 ? values : undefined,
      })
      if (!res.ok) {
        showActionError(res)
        return
      }
      const result = res.data
      if (result.moved) {
        // Moved immediately — there's no approval request to attach to.
        toast.success("Stage advanced")
        setOpen(false)
        reset()
        router.refresh()
      } else {
        toast.success("Sent for approval")
        // If a supporting file was picked, attach it to the new request.
        if (result.approvalRequestId && file) {
          const fd = new FormData()
          fd.set("file", file)
          fd.set("attachableType", "stage_approval_request")
          fd.set("attachableId", result.approvalRequestId)
          fd.set("revalidate", `/funnel/${funnelId}`)
          const up = await uploadEntityAttachment(fd)
          if (up.ok) {
            toast.success("Supporting document attached")
          } else {
            showActionError(up)
          }
        }
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Advance stage</DialogTitle>
          <DialogDescription>
            Move this Funnel to a new stage. Some stages require manager
            approval before the move takes effect.
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
              <div className="flex items-center gap-1.5">
                <Label>Target stage</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label="What does stage probability do?"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <HelpCircleIcon className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent>
                      The percentage on each stage is its win probability — it
                      drives weighted funnel value (amount × probability) in the
                      forecast.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select
                value={targetStageId}
                onValueChange={(v) => setTargetStageId((v as string) ?? "")}
                items={stageItems}
              >
                <SelectTrigger>
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

            {target && collectFields.length > 0 ? (
              <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {enteredStages.length > 1
                    ? `Fill in what's required to reach ${target.name}`
                    : `Required for ${target.name}`}
                </p>
                {groupCustomFields(collectFields).map((group) => (
                  <div
                    key={group.category ?? "__none__"}
                    className="grid gap-3"
                  >
                    {group.category ? (
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.category}
                      </p>
                    ) : null}
                    {group.fields.map((f) => (
                      <CustomFieldControl
                        key={f.key}
                        field={f}
                        value={merged[f.key] ?? ""}
                        onChange={(v) =>
                          setValues((prev) => ({ ...prev, [f.key]: v }))
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}

            {target && missingPresets.length > 0 ? (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="font-medium">Still needed for {target.name}</p>
                <ul className="mt-2 grid gap-1.5">
                  {missingPresets.map((m) => {
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
                  Fill these in, then come back and advance.
                </p>
              </div>
            ) : null}

            {needsReason ? (
              <div className="grid gap-2">
                <Label htmlFor="advance-reason">
                  {isTerminal && target
                    ? closeRemarksLabel(target.kind)
                    : "Reason"}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="advance-reason"
                  placeholder={
                    isTerminal
                      ? "Why is this funnel being closed? (recorded on the stage history)"
                      : "Why should this advance be approved?"
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

            <div className="grid gap-2">
              <Label htmlFor="advance-file">
                Attach supporting document (optional)
              </Label>
              <FileDropzone
                files={file ? [file] : []}
                onFiles={(fs) => setFile(fs[0] ?? null)}
                multiple={false}
                compact
                busy={submitting}
              />
              <p className="text-xs text-muted-foreground">
                If approval is required, this file is attached to the request.
              </p>
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
              <Button
                type="button"
                onClick={onSubmit}
                disabled={submitting || blocked}
              >
                {needsApproval ? "Request advance" : "Advance"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A single typed custom-field input for the advance dialog. */
function CustomFieldControl({
  field,
  value,
  onChange,
}: {
  field: CustomFunnelField
  value: string
  onChange: (value: string) => void
}) {
  const id = `advance-cf-${field.key}`
  const type = field.type ?? "text"

  if (type === "checkbox") {
    return (
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value === "true"}
            onCheckedChange={(c) => onChange(c === true ? "true" : "false")}
          />
          <Label htmlFor={id} className="font-normal">
            {field.label}
          </Label>
        </div>
        {field.description ? (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {type === "select" ? (
        <Select
          value={value}
          onValueChange={(v) => onChange((v as string) ?? "")}
          items={(field.options ?? []).map((o) => ({ value: o, label: o }))}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={type === "number" ? "number" : type === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  )
}
