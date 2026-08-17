export const QUOTATION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "void",
] as const

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]

export type QuotationAction =
  | "submit_for_approval"
  | "approve"
  | "reject_approval"
  | "send"
  | "return_to_draft"
  | "accept"
  | "reject_customer"

export type QuotationPermissionSet = {
  canUpdate: boolean
  canApprove: boolean
  canSend: boolean
  canAccept: boolean
}

export function assertQuotationTransition(
  from: QuotationStatus,
  to: QuotationStatus
): void {
  const allowed =
    (from === "draft" && to === "pending_approval") ||
    (from === "pending_approval" && (to === "approved" || to === "draft")) ||
    (from === "approved" && (to === "sent" || to === "draft")) ||
    (from === "sent" && (to === "accepted" || to === "rejected"))

  if (allowed) return

  if (from === "draft" && to === "sent") {
    throw new Error("Quotation must be approved before it can be sent")
  }
  if (to === "accepted") {
    throw new Error("Only sent quotations can be accepted")
  }
  if (to === "rejected") {
    throw new Error("Only sent quotations can be rejected by the customer")
  }
  throw new Error(`Quotation cannot transition from ${from} to ${to}`)
}

export function assertApprovalRejectionReason(reason: string): string {
  const normalized = reason.trim()
  if (!normalized) throw new Error("Approval rejection reason is required")
  if (normalized.length > 2000) {
    throw new Error("Approval rejection reason must be 2000 characters or fewer")
  }
  return normalized
}

export function quotationActionsFor(
  status: QuotationStatus,
  permissions: QuotationPermissionSet
): QuotationAction[] {
  switch (status) {
    case "draft":
      return permissions.canUpdate ? ["submit_for_approval"] : []
    case "pending_approval":
      return permissions.canApprove ? ["approve", "reject_approval"] : []
    case "approved":
      return [
        ...(permissions.canSend ? ["send" as const] : []),
        ...(permissions.canUpdate ? ["return_to_draft" as const] : []),
      ]
    case "sent":
      return permissions.canAccept ? ["accept", "reject_customer"] : []
    default:
      return []
  }
}

export function isQuotationEditable(status: QuotationStatus): boolean {
  return status === "draft"
}
