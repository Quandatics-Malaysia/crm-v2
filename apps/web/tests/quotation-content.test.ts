import { describe, expect, it } from "vitest"

import {
  assertAttentionContactBelongsToAccount,
  resolveQuotationContent,
  snapshotQuotationLineDescription,
} from "@/lib/quotation-content"

describe("quotation content snapshots", () => {
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
