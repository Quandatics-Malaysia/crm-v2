import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { QuotationDocument } from "@/app/(app)/quotations/actions"
import { EntityQuotationDocument } from "@/app/(app)/quotations/[id]/preview/entity-quotation-document"

const doc = {
  quotation: {
    quoteNumber: "Q-1",
    quoteDate: "2026-08-04",
    createdAt: new Date("2026-08-04T00:00:00Z"),
    validUntil: null,
    currency: "MYR",
    subtotal: "100.00",
    taxTotal: "8.00",
    total: "108.00",
    taxRateSnapshot: "8.000",
    notes: null,
  },
  lines: [],
  entityName: "CITRUS CLOUD SDN BHD",
  entityCode: "CC",
  entitySlug: "citrus-cloud",
  projectName: "Gitlab Services",
  preparedBy: { name: "Finance Team", email: "finance@example.com" },
  pdfTemplateKey: "cc",
  accountQuotationTemplateCode: null,
  company: {
    address: "A-08-01, EKOCHERAS",
    registrationNo: "202201014400 (1460097-U)",
    phone: "+603-2857 8098",
    email: "contact@example.com",
    website: "www.example.com",
    bankDetails: null,
    quoteFooter: null,
    hasLogo: true,
  },
  account: null,
  contact: null,
} as unknown as QuotationDocument

describe("EntityQuotationDocument", () => {
  it("renders CC branding and the tax rate from the quotation snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(EntityQuotationDocument, { doc, template: "cc" })
    )

    expect(html).toContain('src="/api/tenant-logo"')
    expect(html).toContain("Item")
    expect(html).toContain("SKU")
    expect(html).toContain("Subtotal")
    expect(html).toContain("SST @ 8%")
  })
})
