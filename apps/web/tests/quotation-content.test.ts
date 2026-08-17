import { describe, expect, it } from "vitest"

import {
  assertQuotationContentLengths,
  assertAttentionContactBelongsToAccount,
  attentionContactChanged,
  quotationContentAuditSnapshot,
  resolveQuotationContent,
  snapshotQuotationLineDescription,
} from "@/lib/quotation-content"

describe("quotation content snapshots", () => {
  it("rejects content over the persisted field limits", () => {
    expect(() =>
      assertQuotationContentLengths({
        notes: "n".repeat(2001),
        delivery: "d",
        paymentTerm: "p",
      })
    ).toThrow("Notes must be 2000 characters or fewer")

    expect(() =>
      assertQuotationContentLengths({
        notes: "n",
        delivery: "d".repeat(501),
        paymentTerm: "p",
      })
    ).toThrow("Delivery must be 500 characters or fewer")

    expect(() =>
      assertQuotationContentLengths({
        notes: "n",
        delivery: "d",
        paymentTerm: "p".repeat(121),
      })
    ).toThrow("Payment term must be 120 characters or fewer")

    expect(() =>
      assertQuotationContentLengths({
        notes: "n".repeat(2000),
        delivery: "d".repeat(500),
        paymentTerm: "p".repeat(120),
      })
    ).not.toThrow()
  })

  it("does not revalidate an unchanged legacy attention contact", () => {
    expect(attentionContactChanged("legacy-contact", "legacy-contact")).toBe(false)
    expect(attentionContactChanged("legacy-contact", "new-contact")).toBe(true)
    expect(attentionContactChanged("legacy-contact", null)).toBe(true)
  })

  it("audits only quotation content snapshot fields", () => {
    expect(
      quotationContentAuditSnapshot({
        attentionContactId: "contact-1",
        notes: "Customer note",
        delivery: "14 days",
        paymentTerm: "30 days",
      })
    ).toEqual({
      attentionContactId: "contact-1",
      notes: "Customer note",
      delivery: "14 days",
      paymentTerm: "30 days",
    })
  })

  it("seeds omitted content from tenant defaults while preserving edits", () => {
    expect(
      resolveQuotationContent(
        {},
        {
          notes: "Default note",
          delivery: "14 days",
          paymentTerm: "30 days",
        }
      )
    ).toEqual({
      notes: "Default note",
      delivery: "14 days",
      paymentTerm: "30 days",
    })

    expect(
      resolveQuotationContent(
        { notes: "Edited note", delivery: "7 days", paymentTerm: null },
        {
          notes: "Default note",
          delivery: "14 days",
          paymentTerm: "30 days",
        }
      )
    ).toEqual({
      notes: "Edited note",
      delivery: "7 days",
      paymentTerm: null,
    })
  })

  it("rejects an attention contact from another recipient account", () => {
    expect(() =>
      assertAttentionContactBelongsToAccount("contact-account", "recipient-account")
    ).toThrow("Attention contact must belong to recipient account")

    expect(() =>
      assertAttentionContactBelongsToAccount("recipient-account", "recipient-account")
    ).not.toThrow()
  })

  it("keeps an edited product description instead of re-reading the catalog", () => {
    expect(
      snapshotQuotationLineDescription({
        description: "Customer-specific wording",
        productDescription: "Catalog wording",
        productName: "Product",
      })
    ).toBe("Customer-specific wording")
    expect(
      snapshotQuotationLineDescription({
        description: "",
        productDescription: "Catalog wording",
        productName: "Product",
      })
    ).toBe("Catalog wording")
  })
})
