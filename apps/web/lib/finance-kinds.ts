/**
 * The O2C / P2P document chain, as data. One map answers every question the
 * finance module has: what a kind is called, which direction it flows, what
 * it may hang off (an approved sales order and/or a parent document), what
 * number prefix it mints, and whether issuing it settles its parent.
 *
 *   sale     SO → [delivery_order] → invoice → credit_note / receipt
 *   purchase SO → rfq → purchase_order → purchase_invoice → payment
 *                  (or SO → purchase_order directly)
 *
 * Pure module — shared by server actions (validation) and UI (labels/pickers).
 */
export const FINANCE_DOC_KINDS = [
  "delivery_order",
  "invoice",
  "credit_note",
  "receipt",
  "rfq",
  "purchase_order",
  "purchase_invoice",
  "payment",
] as const

export type FinanceDocKind = (typeof FINANCE_DOC_KINDS)[number]

export type FinanceKindMeta = {
  label: string
  /** sale = order-to-cash (money in), purchase = procure-to-pay (money out). */
  direction: "sale" | "purchase"
  /** May this kind be created straight from an approved sales order? */
  fromSalesOrder: boolean
  /** Which document kinds it may hang off as `parentId`. */
  parents: FinanceDocKind[]
  /** Number prefix: {ENTITY}{PREFIX}-0001. */
  prefix: string
  /** Issuing this document marks its parent as settled (receipt/payment). */
  settlesParent?: boolean
}

export const FINANCE_KINDS: Record<FinanceDocKind, FinanceKindMeta> = {
  delivery_order: {
    label: "Delivery order",
    direction: "sale",
    fromSalesOrder: true,
    parents: [],
    prefix: "DO",
  },
  invoice: {
    label: "Invoice",
    direction: "sale",
    // The DO is optional: invoice straight from the SO, or from a DO.
    fromSalesOrder: true,
    parents: ["delivery_order"],
    prefix: "INV",
  },
  credit_note: {
    label: "Credit note",
    direction: "sale",
    fromSalesOrder: false,
    parents: ["invoice"],
    prefix: "CN",
  },
  receipt: {
    label: "Payment receipt",
    direction: "sale",
    fromSalesOrder: false,
    parents: ["invoice"],
    prefix: "RCT",
    settlesParent: true,
  },
  rfq: {
    label: "RFQ",
    direction: "purchase",
    fromSalesOrder: true,
    parents: [],
    prefix: "RFQ",
  },
  purchase_order: {
    label: "Purchase order",
    direction: "purchase",
    // Direct PO from the SO, or via an RFQ.
    fromSalesOrder: true,
    parents: ["rfq"],
    prefix: "PO",
  },
  purchase_invoice: {
    label: "Purchase invoice",
    direction: "purchase",
    fromSalesOrder: false,
    parents: ["purchase_order"],
    prefix: "PINV",
  },
  payment: {
    label: "Payment",
    direction: "purchase",
    fromSalesOrder: false,
    parents: ["purchase_invoice"],
    prefix: "PAY",
    settlesParent: true,
  },
}

/**
 * Whether a document of `kind` may be created with this source. Roots need a
 * sales order; chained kinds need a parent of an allowed kind; kinds that
 * allow both need at least one.
 */
export function canAttach(
  kind: FinanceDocKind,
  parentKind: FinanceDocKind | null,
  hasSalesOrder: boolean
): boolean {
  const meta = FINANCE_KINDS[kind]
  if (parentKind) return meta.parents.includes(parentKind)
  return meta.fromSalesOrder && hasSalesOrder
}

/** Allowed status transitions (draft → issued → settled/cancelled). */
export const FINANCE_STATUS_NEXT: Record<string, string[]> = {
  draft: ["issued", "cancelled"],
  issued: ["settled", "cancelled"],
  settled: [],
  cancelled: [],
}

export function kindsForDirection(
  direction: "sale" | "purchase"
): FinanceDocKind[] {
  return FINANCE_DOC_KINDS.filter(
    (k) => FINANCE_KINDS[k].direction === direction
  )
}
