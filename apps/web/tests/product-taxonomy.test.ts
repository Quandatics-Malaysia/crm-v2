import { describe, expect, it } from "vitest"

import {
  assertTaxonomyRemovalsSafe,
  normalizeProductCategories,
  normalizeQuoteDefaults,
  validateProductTaxonomyPair,
  type ProductCategory,
} from "@/app/(app)/settings/constants"

const categories: ProductCategory[] = [
  {
    code: "PS",
    name: "Professional Services",
    subcategories: [
      { code: "ADVISORY", name: "Advisory" },
      { code: "TRAINING", name: "Training" },
    ],
  },
]

describe("nested product taxonomy", () => {
  it("rejects duplicate category and subcategory codes case-insensitively", () => {
    expect(() =>
      normalizeProductCategories([
        { code: "ps", name: "Services", subcategories: [] },
        { code: "PS", name: "Other", subcategories: [] },
      ])
    ).toThrow(/duplicate product category code/i)

    expect(() =>
      normalizeProductCategories([
        {
          code: "PS",
          name: "Services",
          subcategories: [
            { code: "advisory", name: "Advisory" },
            { code: "ADVISORY", name: "Another Advisory" },
          ],
        },
      ])
    ).toThrow(/duplicate subcategory code/i)
  })

  it("accepts a product pair only when the subcategory belongs to its category", () => {
    expect(validateProductTaxonomyPair(categories, "ps", "training")).toEqual({
      productCode: "PS",
      subcategory: "TRAINING",
    })
    expect(() => validateProductTaxonomyPair(categories, "PS", "ADVISORY-X")).toThrow(
      /does not belong/i
    )
    expect(() => validateProductTaxonomyPair(categories, "MISSING", null)).toThrow(
      /not configured/i
    )
    expect(() => validateProductTaxonomyPair(categories, null, "TRAINING")).toThrow(
      /requires a product category/i
    )
  })

  it("protects category and subcategory values still referenced by products", () => {
    expect(() =>
      assertTaxonomyRemovalsSafe(
        categories,
        [{ code: "PS", name: "Professional Services", subcategories: [] }],
        [{ productCode: "PS", subcategory: "TRAINING" }]
      )
    ).toThrow(/TRAINING.*in use/i)

    expect(() =>
      assertTaxonomyRemovalsSafe(
        categories,
        [],
        [{ productCode: "PS", subcategory: null }]
      )
    ).toThrow(/PS.*in use/i)

    expect(() =>
      assertTaxonomyRemovalsSafe(
        categories,
        [{ code: "PS", name: "Renamed", subcategories: categories[0].subcategories }],
        [{ productCode: "PS", subcategory: "TRAINING" }]
      )
    ).not.toThrow()
  })
})

describe("quotation defaults", () => {
  it("trims and persists defaults within each explicit field limit", () => {
    expect(
      normalizeQuoteDefaults({
        notes: "  Include implementation assumptions.  ",
        delivery: "  Within 10 business days. ",
        paymentTerm: "  30 days  ",
      })
    ).toEqual({
      notes: "Include implementation assumptions.",
      delivery: "Within 10 business days.",
      paymentTerm: "30 days",
    })
  })

  it.each([
    ["notes", "n", 2000],
    ["delivery", "d", 500],
    ["paymentTerm", "p", 120],
  ] as const)("rejects an overlong %s default", (field, character, max) => {
    expect(() =>
      normalizeQuoteDefaults({
        notes: field === "notes" ? character.repeat(max + 1) : "",
        delivery: field === "delivery" ? character.repeat(max + 1) : "",
        paymentTerm: field === "paymentTerm" ? character.repeat(max + 1) : "",
      })
    ).toThrow(new RegExp(`${field}.*${max}`, "i"))
  })
})
