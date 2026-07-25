/**
 * Pure invoice-reminder math. The tenant schedule lists days AFTER the due
 * date at which reminder 1, 2, 3… become due (e.g. [7, 14, 30]).
 */

/** How many reminder thresholds have passed for a due date (0 = none). */
export function reminderStageDue(
  dueDate: string | null,
  schedule: number[],
  today: Date
): number {
  if (!dueDate || schedule.length === 0) return 0
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return 0
  const daysOver = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
  return schedule.filter((d) => daysOver >= d).length
}

/** Whole days a due date is overdue (0 when not yet due / no due date). */
export function daysOverdue(dueDate: string | null, today: Date): number {
  if (!dueDate) return 0
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return 0
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000))
}
