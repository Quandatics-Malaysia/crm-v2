import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { extractText } from "@/app/documentation/extract-text"
import { financePage } from "@/app/documentation/content-finance"
import {
  leadToCashPage,
  projectsPage,
} from "@/app/documentation/content-sales"
import { DOC_GROUPS } from "@/app/documentation/registry"

const paymentMilestoneDocumentation = [
  extractText(leadToCashPage.body),
  extractText(projectsPage.body),
  extractText(financePage.body),
].join(" ").replace(/\s+/g, " ")

const documentationDirectory = fileURLToPath(
  new URL("../app/documentation/", import.meta.url)
)
const documentationSource = [
  ...readdirSync(documentationDirectory)
    .filter((file) => /^content-.*\.tsx$/.test(file))
    .map((file) => resolve(documentationDirectory, file)),
  `${documentationDirectory}/schema-data.ts`,
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

const renderedDocumentation = DOC_GROUPS.flatMap((group) => group.pages)
  .map((page) => extractText(page.body))
  .join(" ")
  .replace(/\s+/g, " ")

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
    const forbiddenStaleClaims = [
      /pending\s*(?:→|->)\s*invoiced\s*(?:→|->)\s*paid/i,
      /milestones?\s*(?:→|->|to)\s*paid/i,
      /(?:all|fully)\s+milestones?\s+paid/i,
      /one-click\s+(?:draft(?:s)?\s+the\s+)?invoice/i,
      /one\s+live\s+invoice\s+per\s+milestone/i,
      /live\s+invoice/i,
      /auto[- ]complete(?:s|d)?\s+(?:the\s+)?project/i,
      /auto_complete_project_on_paid/i,
      /payment_milestone_status\s*\([^)]*\b(?:pending|paid)\b/i,
      /finance_docs_live_milestone_uq/i,
    ]

    for (const claim of forbiddenStaleClaims) {
      expect(documentationSource).not.toMatch(claim)
    }

    expect(renderedDocumentation).not.toContain("pending → invoiced → paid")
    expect(renderedDocumentation).not.toContain("milestone → paid")
    expect(renderedDocumentation).not.toContain("auto-complete the project")
  })

  it("covers Overview, Reference, schema, and every registered documentation page", () => {
    expect(renderedDocumentation).toContain(
      "Payment Milestones are planning records with only two statuses"
    )
    expect(documentationSource).toContain(
      "payment_milestone_status (won | invoiced)"
    )
    expect(documentationSource).toContain("no live linkage")
  })
})
