import { describe, expect, it } from "vitest"
import {
  FINANCE_KINDS,
  FINANCE_DOC_KINDS,
  FINANCE_STATUS_NEXT,
  canAttach,
  kindsForDirection,
} from "@/lib/finance-kinds"

describe("finance document chain", () => {
  it("O2C: SO → DO(optional) → invoice → credit note / receipt", () => {
    expect(canAttach("delivery_order", null, true)).toBe(true)
    expect(canAttach("invoice", null, true)).toBe(true) // DO is optional
    expect(canAttach("invoice", "delivery_order", false)).toBe(true)
    expect(canAttach("credit_note", "invoice", false)).toBe(true)
    expect(canAttach("receipt", "invoice", false)).toBe(true)
  })

  it("P2P: SO → RFQ or direct PO → purchase invoice → payment", () => {
    expect(canAttach("rfq", null, true)).toBe(true)
    expect(canAttach("purchase_order", null, true)).toBe(true) // direct PO
    expect(canAttach("purchase_order", "rfq", false)).toBe(true)
    expect(canAttach("purchase_invoice", "purchase_order", false)).toBe(true)
    expect(canAttach("payment", "purchase_invoice", false)).toBe(true)
  })

  it("rejects out-of-chain attachments", () => {
    expect(canAttach("receipt", null, true)).toBe(false) // needs an invoice
    expect(canAttach("credit_note", "delivery_order", false)).toBe(false)
    expect(canAttach("payment", "invoice", false)).toBe(false) // wrong pipeline
    expect(canAttach("purchase_invoice", null, true)).toBe(false) // needs a PO
    expect(canAttach("delivery_order", null, false)).toBe(false) // no SO
  })

  it("only receipts and payments settle their parent", () => {
    const settlers = FINANCE_DOC_KINDS.filter((k) => FINANCE_KINDS[k].settlesParent)
    expect(settlers).toEqual(["receipt", "payment"])
  })

  it("directions split cleanly and cover all kinds", () => {
    const sale = kindsForDirection("sale")
    const purchase = kindsForDirection("purchase")
    expect(sale).toEqual(["delivery_order", "invoice", "credit_note", "receipt"])
    expect(purchase).toEqual(["rfq", "purchase_order", "purchase_invoice", "payment"])
    expect([...sale, ...purchase].sort()).toEqual([...FINANCE_DOC_KINDS].sort())
  })

  it("status machine: draft → issued → settled/cancelled, terminals stay put", () => {
    expect(FINANCE_STATUS_NEXT.draft).toContain("issued")
    expect(FINANCE_STATUS_NEXT.issued).toContain("settled")
    expect(FINANCE_STATUS_NEXT.settled).toEqual([])
    expect(FINANCE_STATUS_NEXT.cancelled).toEqual([])
    expect(FINANCE_STATUS_NEXT.draft).not.toContain("settled") // can't settle a draft
  })

  it("every kind has a unique number prefix", () => {
    const prefixes = FINANCE_DOC_KINDS.map((k) => FINANCE_KINDS[k].prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})
