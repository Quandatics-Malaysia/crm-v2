export const PAYMENT_MILESTONE_STATUSES = ["won", "invoiced"] as const

export type PaymentMilestoneStatus = (typeof PAYMENT_MILESTONE_STATUSES)[number]

export function canTransitionPaymentMilestone(
  from: PaymentMilestoneStatus,
  to: PaymentMilestoneStatus
): boolean {
  return from === to || (from === "won" && to === "invoiced")
}

export function markLiveMilestonesWon<
  T extends { id: string; status: PaymentMilestoneStatus },
>(milestones: readonly T[]): T[] {
  return milestones.map((milestone) => ({ ...milestone, status: "won" }))
}
