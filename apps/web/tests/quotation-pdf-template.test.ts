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

  it("uses entity identity when no explicit template is configured", () => {
    expect(
      resolveQuotationPdfTemplate({
        entitySlug: "q-armour",
        entityName: "Q Armour Sdn Bhd",
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

  it("uses explicit template code before entity identity", () => {
    expect(
      resolveQuotationPdfTemplate({
        rawTemplateCode: "cc",
        entityCode: "QAR",
        entitySlug: "q-armour",
        entityName: "Q Armour Sdn Bhd",
      })
    ).toBe("cc")
  })

  it("falls back from bad explicit code to entity identity", () => {
    expect(
      resolveQuotationPdfTemplate({
        rawTemplateCode: "acme",
        entityCode: "CC",
      })
    ).toBe("cc")
  })
})
