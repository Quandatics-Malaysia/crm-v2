import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { TenantSettingsView } from "@/app/(app)/settings/actions"
import { InvoicingClient } from "@/app/(app)/settings/billing/invoicing/invoicing-client"
import { DocumentsClient } from "@/app/(app)/settings/documents/documents-client"

const settings = {
  quoteDefaultNotes: "Default notes",
  quoteDefaultDelivery: "Default delivery",
  quoteDefaultPaymentTerm: "30 days",
  paymentTerms: ["30 days"],
  soDocumentKinds: ["PO"],
  invoiceReminderDays: [7, 14, 30],
  financeEnabled: true,
} as TenantSettingsView

describe("quotation-default settings ownership", () => {
  it("renders the quotation-default form on Documents Settings", () => {
    const html = renderToStaticMarkup(
      createElement(DocumentsClient, { settings })
    )

    expect(html).toMatch(/<form(?:\s|>)/)
    expect(html).toContain("Quotation defaults")
    expect(html).not.toContain("Notes copied to new quotations")
    expect(html).toContain("Delivery")
    expect(html).toContain("Payment Term")
    expect(html).toContain("Save quotation defaults")
  })

  it("does not render quotation defaults on the Invoicing client", () => {
    const html = renderToStaticMarkup(
      createElement(InvoicingClient, { settings })
    )

    expect(html).not.toContain("Quotation defaults")
    expect(html).not.toContain("Save quotation defaults")
    expect(html).toContain("Payment terms")
    expect(html).toContain("Sales-order document kinds")
    expect(html).toContain("Invoice reminders")
  })
})
