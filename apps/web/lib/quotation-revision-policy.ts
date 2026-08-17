import type { QuotationStatus } from "./quotation-transitions"

const LIVE_REVISION_STATUSES = new Set<QuotationStatus>([
  "sent",
  "accepted",
  "rejected",
  "expired",
  "void",
])

/**
 * Historical revision policy. Live quotes may be revised only after they have
 * reached a customer-facing terminal state. A soft-deleted non-Draft row is
 * still eligible history; live Pending Approval and Approved rows are not.
 */
export function canCreateQuotationRevision(
  status: QuotationStatus,
  deletedAt: Date | string | null | undefined
): boolean {
  if (deletedAt) return status !== "draft"
  return LIVE_REVISION_STATUSES.has(status)
}
