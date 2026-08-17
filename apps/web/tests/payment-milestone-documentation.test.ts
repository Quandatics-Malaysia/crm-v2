import { describe, expect, it } from "vitest"

import { extractText } from "@/app/documentation/extract-text"
import { financePage } from "@/app/documentation/content-finance"
import {
  leadToCashPage,
  projectsPage,
} from "@/app/documentation/content-sales"

const paymentMilestoneDocumentation = [
  extractText(leadToCashPage.body),
  extractText(projectsPage.body),
  extractText(financePage.body),
].join(" ").replace(/\s+/g, " ")

describe("payment milestone documentation", () => {
  it("describes the decoupled two-state lifecycle and its boundaries", () => {
    expect(paymentMilestoneDocumentation).toMatch(
      /Payment Milestones are planning records with only two statuses: Won and Invoiced/
    )
    expect(paymentMilestoneDocumentation).toContain(
      "They may be prepared before a Funnel closes"
    )
    expect(paymentMilestoneDocumentation).toContain(
      "Closed Won marks live milestones Won"
    )
    expect(paymentMilestoneDocumentation).toMatch(
      /A user manually changes Won to Invoiced/
    )
    expect(paymentMilestoneDocumentation).toContain(
      "Payment Milestones do not create or update invoices or receipts and never complete a Project automatically."
    )
  })

  it("does not render the legacy pending/paid or automatic-coupling claims", () => {
    expect(paymentMilestoneDocumentation).not.toContain(
      "pending → invoiced → paid"
    )
    expect(paymentMilestoneDocumentation).not.toContain(
      "milestone → paid"
    )
    expect(paymentMilestoneDocumentation).not.toContain(
      "milestone to paid"
    )
    expect(paymentMilestoneDocumentation).not.toContain(
      "back to pending"
    )
    expect(paymentMilestoneDocumentation).not.toContain(
      "auto-complete the project"
    )
  })
})
