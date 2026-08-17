import {
  normalizeProductSubcategoryCode,
  PRODUCT_SUBCATEGORY_CODE_MAX,
  type ProductCategory,
} from "@/app/(app)/settings/constants"

/** Allocate a deterministic subcategory code for a legacy display name. */
export function allocateProductSubcategoryCode(
  taxonomy: ProductCategory[],
  categoryCode: string,
  displayName: string
): string {
  const category = taxonomy.find(
    (candidate) => candidate.code.toUpperCase() === categoryCode.toUpperCase()
  )
  const name = displayName.trim()
  const existing = category?.subcategories.find(
    (subcategory) => subcategory.name.trim().toLowerCase() === name.toLowerCase()
  )
  if (existing) return existing.code

  const usedCodes = new Set(
    taxonomy.flatMap((candidate) =>
      candidate.subcategories.map((subcategory) =>
        normalizeProductSubcategoryCode(subcategory.code)
      )
    )
  )
  const base =
    normalizeProductSubcategoryCode(name)
      .replace(/[^A-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, PRODUCT_SUBCATEGORY_CODE_MAX) || "SUBCATEGORY"

  for (let suffix = 1; ; suffix += 1) {
    const suffixText = suffix === 1 ? "" : `_${suffix}`
    const code = `${base.slice(
      0,
      PRODUCT_SUBCATEGORY_CODE_MAX - suffixText.length
    )}${suffixText}`
    if (!usedCodes.has(code)) return code
  }
}
