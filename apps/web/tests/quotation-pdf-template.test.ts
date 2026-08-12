import { describe, expect, it } from "vitest"

import { resolveQuotationPdfTemplate } from "@/lib/quotation-pdf-template"

describe("resolveQuotationPdfTemplate", () => {
  it.each([
    ["QAR", "anything", "anything", "qar"],
    [null, "q-armour", "Q Armour", "qar"],
    ["CC", "anything", "anything", "cc"],
    [null, "citrus-cloud", "Citrus Cloud", "cc"],
  ])("maps code %s / entity %s / %s to %s", (code, slug, name, expected) => {
    expect(resolveQuotationPdfTemplate({ entityCode: code, entitySlug: slug, entityName: name })).toBe(
      expected
    )
  })

  it("uses configured entity code even when organization was renamed", () => {
    expect(
      resolveQuotationPdfTemplate({
        entityCode: "CC",
        entitySlug: "aasdd",
        entityName: "aasdd",
      })
    ).toBe("cc")
  })

  it("uses entity identity instead of customer account code", () => {
    expect(
      resolveQuotationPdfTemplate({
        entitySlug: "q-armour",
        entityName: "Q Armour Sdn Bhd",
        legacyKey: "CC",
      })
    ).toBe("qar")
  })

  it("falls back to default for an unregistered entity", () => {
    expect(
      resolveQuotationPdfTemplate({
        entitySlug: "new-company",
        entityName: "New Company Sdn Bhd",
      })
    ).toBe("default")
  })
})
