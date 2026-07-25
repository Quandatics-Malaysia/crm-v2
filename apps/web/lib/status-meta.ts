/**
 * Single source of truth for status ENUM OPTIONS used in forms/selects.
 * Rendering a status uses <StatusBadge> (components/status-badge.tsx), whose
 * semantic tone map keeps the same meaning in the same color everywhere —
 * this module only owns the value/label lists so they never drift per file.
 *
 * The value sets mirror the Postgres enums (db/schema); they are workflow
 * state machines, so the SETS are fixed — only labels may evolve here.
 */

export type StatusOption<T extends string = string> = {
  value: T
  label: string
}

export const LEAD_STATUS_OPTIONS: StatusOption[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
  { value: "converted", label: "Converted" },
]

export const PROJECT_STATUS_OPTIONS: StatusOption[] = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

export const MILESTONE_STATUS_OPTIONS: StatusOption[] = [
  { value: "pending", label: "Pending" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
]

/** How a funnel stage change happened (funnel_stage_history.source). */
export const STAGE_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  approval: "Via approval",
  quote_accept: "Quote accepted",
  reopen: "Reopened",
}
