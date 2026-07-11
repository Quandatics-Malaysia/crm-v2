import { PERMISSIONS, type PermissionKey } from "@/lib/permissions"

/**
 * Plain (non-"use server") module so it can export runtime values — the
 * attachment permission map is imported by both the server actions and the
 * file-download route.
 */
export type AttachableType =
  | "stage_approval_request"
  | "quotation"
  | "opportunity"
  | "account"
  | "lead"
  | "person"
  | "project"
  | "sales_order"
  | "finance_doc"
  | "opportunity_container"

/**
 * Attachment authority is derived from the parent record: you may view a file
 * if you can view its record, and add/rename/delete a file if you can modify
 * its record. (Record-level scoping of the specific target lands with the
 * ownership model; this restores the missing capability check.)
 */
export const ATTACH_PERMS: Record<
  AttachableType,
  { view: PermissionKey; write: PermissionKey }
> = {
  account: { view: PERMISSIONS.ACCOUNT_VIEW, write: PERMISSIONS.ACCOUNT_UPDATE },
  person: { view: PERMISSIONS.PERSON_VIEW, write: PERMISSIONS.PERSON_UPDATE },
  lead: { view: PERMISSIONS.LEAD_VIEW, write: PERMISSIONS.LEAD_UPDATE },
  opportunity: {
    view: PERMISSIONS.OPPORTUNITY_VIEW,
    write: PERMISSIONS.OPPORTUNITY_UPDATE,
  },
  opportunity_container: {
    view: PERMISSIONS.OPPORTUNITY_VIEW,
    write: PERMISSIONS.OPPORTUNITY_UPDATE,
  },
  quotation: {
    view: PERMISSIONS.QUOTATION_VIEW,
    write: PERMISSIONS.QUOTATION_UPDATE,
  },
  project: { view: PERMISSIONS.PROJECT_VIEW, write: PERMISSIONS.PROJECT_UPDATE },
  sales_order: {
    view: PERMISSIONS.SALES_ORDER_VIEW,
    write: PERMISSIONS.SALES_ORDER_SUBMIT,
  },
  stage_approval_request: {
    view: PERMISSIONS.OPPORTUNITY_VIEW,
    write: PERMISSIONS.STAGE_ADVANCE,
  },
  finance_doc: {
    view: PERMISSIONS.FINANCE_VIEW,
    write: PERMISSIONS.FINANCE_MANAGE,
  },
}

export function attachViewPerm(type: AttachableType): PermissionKey {
  const p = ATTACH_PERMS[type]
  if (!p) throw new Error("Unknown attachment target")
  return p.view
}

export function attachWritePerm(type: AttachableType): PermissionKey {
  const p = ATTACH_PERMS[type]
  if (!p) throw new Error("Unknown attachment target")
  return p.write
}
