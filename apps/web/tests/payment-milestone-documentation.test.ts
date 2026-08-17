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

  it("rejects positive claims split by raw JSX tags and expressions", () => {
    const rawJsx = `<P>A <B>one live</B>{" "}<Code>invoice</Code> per milestone.</P>`

    expect(findForbiddenStaleClaims(rawJsx)).toContain(
      "one live invoice per milestone"
    )
    expect(
      findForbiddenStaleClaims(
        `<P data-claim="one live invoice per milestone">{oneLiveInvoicePerMilestone}</P>`
      )
      ).toEqual([])
  })

  it("strips dynamic JSX expressions but preserves standalone string literals", () => {
    expect(
      findForbiddenStaleClaims(`<P>one live {invoice} per milestone.</P>`)
    ).toEqual([])
    expect(
      findForbiddenStaleClaims(`<P>one {"live invoice"} per milestone.</P>`)
    ).toContain("one live invoice per milestone")
    expect(
      findForbiddenStaleClaims(
        `<P>{condition ? "one live invoice per milestone" : ""}</P>`
      )
    ).toEqual([])
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

  it("does not let a negated clause suppress a later positive claim", () => {
    const clauses = [
      "Payment Milestones do not create a one-click invoice, but the legacy flow uses a one-click invoice.",
      "Payment Milestones do not create a one-click invoice. However, the legacy flow uses a one-click invoice.",
    ]

    for (const wording of clauses) {
      expect(findForbiddenStaleClaims(wording)).toContain("one-click invoice")
    }
  })

  it("carries negation across coordinated predicates", () => {
    const coordinated = [
      "Payment Milestones do not create or update a one-click invoice.",
      "Payment Milestones do not create and update a one-click invoice.",
    ]

    for (const wording of coordinated) {
      expect(findForbiddenStaleClaims(wording)).toEqual([])
    }
  })
})
