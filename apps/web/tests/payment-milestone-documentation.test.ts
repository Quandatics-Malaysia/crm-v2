import * as React from "react"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { extractText } from "@/app/documentation/extract-text"
import { B, Code } from "@/app/documentation/doc-kit"
import { financePage } from "@/app/documentation/content-finance"
import {
  leadToCashPage,
  projectsPage,
} from "@/app/documentation/content-sales"
import { DOC_GROUPS } from "@/app/documentation/registry"
import {
  findForbiddenStaleClaims,
  normalizeDocumentation,
} from "@/app/documentation/stale-claims"

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

const renderedDocumentation = normalizeDocumentation(
  DOC_GROUPS.flatMap((group) => group.pages)
  .map((page) => extractText(page.body))
  .join(" ")
)

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
    expect(findForbiddenStaleClaims(documentationSource)).toEqual([])
    expect(findForbiddenStaleClaims(renderedDocumentation)).toEqual([])
  })

  it("covers Overview, Reference, schema, and every registered documentation page", () => {
    expect(renderedDocumentation).toContain(
      "Payment Milestones are planning records with only two statuses"
    )
    expect(documentationSource).toContain(
      "payment_milestone_status (won | invoiced)"
    )
    expect(documentationSource).toContain("no live linkage")
    expect(documentationSource).toContain(
      'FUNNELS |o--o{ PAYMENT_MILESTONES : "optional funnel owner"'
    )
    expect(documentationSource).toContain(
      'PROJECTS |o--o{ PAYMENT_MILESTONES : "optional project owner"'
    )
  })

  it("rejects JSX-split positive coupling claims after rendering text", () => {
    const splitClaim = normalizeDocumentation(
      extractText([
        "A ",
        React.createElement(B, null, "one live"),
        " ",
        React.createElement(Code, null, "invoice"),
        " per milestone.",
      ])
    )

    expect(splitClaim).toContain("one live invoice per milestone")
    expect(findForbiddenStaleClaims(splitClaim)).toContain(
      "one live invoice per milestone"
    )
  })

  it("allows accurate negated coupling wording", () => {
    const accurateNegations = [
      "Payment Milestones do not create a one-click invoice.",
      "There is no live invoice per milestone.",
      "The project does not auto-complete the project.",
      "A milestone → paid transition is not supported.",
    ]

    for (const wording of accurateNegations) {
      expect(findForbiddenStaleClaims(normalizeDocumentation(wording))).toEqual(
        []
      )
    }
  })
})
