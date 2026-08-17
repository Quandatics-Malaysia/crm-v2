import { describe, expect, it } from "vitest"

import { resolveAccountCurrency } from "@/app/(app)/accounts/actions"
import { resolveOpportunityCurrency } from "@/app/(app)/funnel/actions"
import { normalizeLeadInput, type LeadInput } from "@/app/(app)/leads/actions"
import { resolveQuotationCurrency } from "@/app/(app)/quotations/actions"
import { resolveDefaultSalesFunnel } from "@/server/services/conversion"
import {
  resolveAccountCurrencyBackfill,
  resolveConfiguredCurrency,
} from "@/server/services/tenant-currency"

describe("account persistence currency rules", () => {
  it("rejects free-text currencies during account create", () => {
    expect(() => resolveAccountCurrency("EUR", ["MYR", "USD"], "USD")).toThrow(
      /configured currencies/
    )
  })

  it("rejects free-text currencies during account update", () => {
    expect(() => resolveAccountCurrency("EUR", ["MYR", "USD"], "USD")).toThrow(
      /configured currencies/
    )
  })

  it("defaults missing input from a configured tenant currency", () => {
    expect(resolveAccountCurrency(undefined, ["MYR", "USD"], "USD")).toBe("USD")
    expect(resolveAccountCurrency("usd", ["MYR", "USD"], "MYR")).toBe("USD")
  })
})

describe("opportunity and quotation currency persistence", () => {
  it("defaults opportunity creation from the account and validates overrides", () => {
    expect(resolveOpportunityCurrency(undefined, "USD", ["MYR", "USD"], "MYR")).toBe("USD")
    expect(() => resolveOpportunityCurrency("EUR", "USD", ["MYR", "USD"], "MYR")).toThrow(
      /configured currencies/
    )
  })

  it("defaults quotation creation from its funnel and validates overrides", () => {
    expect(resolveQuotationCurrency(undefined, "USD", ["MYR", "USD"], "MYR")).toBe("USD")
    expect(() => resolveQuotationCurrency("EUR", "USD", ["MYR", "USD"], "MYR")).toThrow(
      /configured currencies/
    )
  })
})

describe("tenant currency migration behavior", () => {
  it("keeps a configured default, otherwise chooses first configured currency", () => {
    expect(resolveAccountCurrencyBackfill("usd", ["MYR", "USD"])).toBe("USD")
    expect(resolveAccountCurrencyBackfill("EUR", ["MYR", "USD"])).toBe("MYR")
  })

  it("falls back to MYR when settings have no valid currencies", () => {
    expect(resolveAccountCurrencyBackfill("EUR", [])).toBe("MYR")
  })

  it("uses the first configured currency when tenant default is invalid", () => {
    expect(resolveConfiguredCurrency(undefined, ["SGD", "USD"], "EUR")).toBe("SGD")
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
