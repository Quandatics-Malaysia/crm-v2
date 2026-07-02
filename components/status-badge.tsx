import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Semantic tone shared by every status surface so the same meaning always
 *  reads in the same color. The "won/approved" moment (accepted / approved /
 *  converted / won) all map to one emerald success treatment. */
export type StatusTone = "success" | "danger" | "warning" | "info" | "neutral"

const TONE_CLASSES: Record<StatusTone, string> = {
  success:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
}

/** Maps a raw status/kind string to its semantic tone. Case-insensitive. */
const STATUS_TONE: Record<string, StatusTone> = {
  // success — the deal/quote/order reached a positive terminal state
  accepted: "success",
  approved: "success",
  converted: "success",
  won: "success",
  active: "success",
  completed: "success",
  paid: "success",
  // danger — negative terminal / removed
  rejected: "danger",
  disqualified: "danger",
  lost: "danger",
  void: "danger",
  expired: "danger",
  disabled: "danger",
  cancelled: "danger",
  declined: "danger",
  // warning — awaiting a decision / on hold
  pending: "warning",
  pending_review: "warning",
  parked: "warning",
  kiv: "warning",
  invited: "warning",
  on_hold: "warning",
  contacted: "warning",
  // info — in flight
  sent: "info",
  submitted: "info",
  open: "info",
  qualified: "info",
  invoiced: "info",
  // neutral — not yet started
  draft: "neutral",
  new: "neutral",
  planning: "neutral",
  planned: "neutral",
}

/** Tone for a status string; falls back to neutral for anything unmapped. */
export function statusTone(status: string): StatusTone {
  return STATUS_TONE[status?.toLowerCase()] ?? "neutral"
}

/** Rounded-full pill shape so solid-tone badges read as pills, not filled cells. */
const PILL_CLASS = "rounded-full"

function defaultLabel(status: string) {
  if (!status) return status
  return status
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Shared status pill. Pass `tone` to override the inferred tone, or `label`
 *  to override the humanized status text. */
export function StatusBadge({
  status,
  tone,
  label,
  className,
}: {
  status: string
  tone?: StatusTone
  label?: React.ReactNode
  className?: string
}) {
  const resolved = tone ?? statusTone(status)
  return (
    <Badge className={cn(TONE_CLASSES[resolved], PILL_CLASS, className)}>
      {label ?? defaultLabel(status)}
    </Badge>
  )
}
