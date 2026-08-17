import { describe, expect, it } from "vitest"

import { resolveAccountCurrency } from "@/app/(app)/accounts/actions"
import { normalizeLeadInput, type LeadInput } from "@/app/(app)/leads/actions"
import { resolveDefaultSalesFunnel } from "@/server/services/conversion"

describe("account currency rules", () => {
  it("rejects free-text currencies and defaults missing input from tenant currency", () => {
    expect(resolveAccountCurrency(undefined, ["MYR", "USD"], "USD")).toBe("USD")
    expect(resolveAccountCurrency("usd", ["MYR", "USD"], "MYR")).toBe("USD")
    expect(() => resolveAccountCurrency("EUR", ["MYR", "USD"], "MYR")).toThrow(
      /configured currencies/
    )
  })
})

describe("lead create/update rules", () => {
  it("does not persist funnel or stage fields from a lead payload", () => {
    const input = {
      name: "Jane Doe",
      companyName: "Acme",
      email: "jane@acme.test",
      phone: "+60123456789",
      source: "Referral",
      status: "new" as const,
      pipelineId: "legacy-pipeline",
      currentStageId: "legacy-stage",
    } as LeadInput & { pipelineId: string; currentStageId: string }

    expect(normalizeLeadInput(input)).toEqual({
      name: "Jane Doe",
      companyName: "Acme",
      email: "jane@acme.test",
      phone: "+60123456789",
      source: "Referral",
      status: "new",
    })
  })
})

describe("lead conversion defaults", () => {
  it("selects default Sales Funnel and its first OPEN 0E stage", () => {
    expect(
      resolveDefaultSalesFunnel(
        [
          { id: "legacy", name: "Legacy Pipeline", isDefault: false },
          { id: "sales", name: "Sales Funnel", isDefault: true },
        ],
        [
          { id: "late-0e", pipelineId: "sales", code: "0e", kind: "OPEN", sortOrder: 10 },
          { id: "won", pipelineId: "sales", code: "won", kind: "WON", sortOrder: 20 },
          { id: "first-0e", pipelineId: "sales", code: "0e", kind: "OPEN", sortOrder: 0 },
        ]
      )
    ).toEqual({ pipelineId: "sales", stageId: "first-0e" })
  })

  it("does not fall back to a legacy non-default pipeline", () => {
    expect(() =>
      resolveDefaultSalesFunnel(
        [{ id: "legacy", name: "Legacy Pipeline", isDefault: false }],
        [{ id: "stage", pipelineId: "legacy", code: "0e", kind: "OPEN", sortOrder: 0 }]
      )
    ).toThrow(/default Sales Funnel/)
  })
})
