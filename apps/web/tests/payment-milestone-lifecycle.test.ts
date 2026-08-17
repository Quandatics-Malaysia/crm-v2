import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  PAYMENT_MILESTONE_STATUSES,
  canTransitionPaymentMilestone,
  markLiveMilestonesWon,
} from "@/lib/payment-milestone-lifecycle"

describe("payment milestone lifecycle", () => {
  it("exposes only Won and Invoiced statuses", () => {
    expect(PAYMENT_MILESTONE_STATUSES).toEqual(["won", "invoiced"])
  })

  it("allows only manual Won to Invoiced progression", () => {
    expect(canTransitionPaymentMilestone("won", "invoiced")).toBe(true)
    expect(canTransitionPaymentMilestone("invoiced", "won")).toBe(false)
    expect(canTransitionPaymentMilestone("invoiced", "invoiced")).toBe(true)
  })

  it("marks every live milestone Won when an opportunity closes Won", () => {
    expect(
      markLiveMilestonesWon([
        { id: "before-close", status: "won" },
        { id: "already-invoiced", status: "invoiced" },
      ])
    ).toEqual([
      { id: "before-close", status: "won" },
      { id: "already-invoiced", status: "won" },
    ])
  })

  it("adds a compatibility migration that maps legacy statuses and preserves invoice columns", async () => {
    const migration = await readFile(
      path.resolve(process.cwd(), "db/migrations/0083_payment_milestone_decoupling.sql"),
      "utf8"
    )

    expect(migration).toMatch(/pending[\s\S]{0,160}won/i)
    expect(migration).toMatch(/paid[\s\S]{0,160}invoiced/i)
    expect(migration).toMatch(/invoice_number/i)
    expect(migration).toMatch(/invoice_date/i)
    expect(migration).toMatch(/milestone_id/i)
    expect(migration).toMatch(/DROP TYPE/i)
  })

  it("removes invoice creation, finance-tab, and project-completion coupling from milestone flows", async () => {
    const files = [
      "app/(app)/billing/actions.ts",
      "app/(app)/payment-milestones/[id]/page.tsx",
      "app/(app)/payment-milestones/payment-milestone-detail-body.tsx",
      "app/(app)/projects/[id]/billing-panel.tsx",
      "app/(app)/projects/actions.ts",
      "server/services/finance.ts",
    ]
    const contents = await Promise.all(
      files.map((file) =>
        readFile(path.resolve(process.cwd(), file), "utf8")
      )
    )
    const source = contents.join("\n")

    expect(source).not.toMatch(/createInvoiceFromMilestone/)
    expect(source).not.toMatch(/listMilestoneFinanceDocs/)
    expect(source).not.toMatch(/maybeCompleteProject/)
    expect(source).not.toMatch(/paymentMilestones\.status.*paid/)
  })
})
