/** Canonical stage codes/kinds. Kept out of the "use server" actions file
 *  (which may only export async functions). */
import { ROLE_TEMPLATES } from "@/lib/permissions"

/** Assignable auto-join roles (never Owner — that's for the workspace creator).
 *  Lives here (not in the "use server" actions file, which may only export
 *  async functions) so both the server action and the client card can import it. */
export const AUTO_JOIN_ROLES = ROLE_TEMPLATES.filter(
  (r) => r.name !== "Owner"
).map((r) => r.name)

export const STAGE_CODES = [
  "0e",
  "1d",
  "2c",
  "3b",
  "4a",
  "won",
  "lost",
  "kiv",
] as const
export type StageCode = (typeof STAGE_CODES)[number]

export const STAGE_KINDS = ["OPEN", "WON", "LOST", "PARKED"] as const
export type StageKind = (typeof STAGE_KINDS)[number]

/** Human-readable label for each raw stage code, e.g. "2c → Proposal (2c)". */
export const STAGE_CODE_LABELS: Record<StageCode, string> = {
  "0e": "Identified (0e)",
  "1d": "Qualified (1d)",
  "2c": "Proposal (2c)",
  "3b": "Negotiation (3b)",
  "4a": "Commit (4a)",
  won: "Closed Won (won)",
  lost: "Closed Lost (lost)",
  kiv: "Keep In View (kiv)",
}

/** Friendly label for each stage Kind. */
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  OPEN: "Open — active funnel",
  WON: "Won — closed successfully",
  LOST: "Lost — closed, not pursued",
  PARKED: "Parked / on-hold (KIV)",
}

/**
 * What Kind controls: it is the locked semantic class that drives pipeline and
 * forecast logic — only OPEN/WON deals count toward the forecast, and WON/LOST
 * are terminal closes. Pick it to match the Code; it can't be changed later.
 */
export const STAGE_KIND_DESCRIPTION =
  ""

/** Suggested Kind for a given Code (used to auto-fill on Code change). */
export function suggestKindForCode(code: StageCode): StageKind {
  if (code === "won") return "WON"
  if (code === "lost") return "LOST"
  if (code === "kiv") return "PARKED"
  return "OPEN"
}

/** Whether a Kind should be counted in the forecast by default. */
export function defaultIncludeInForecast(kind: StageKind): boolean {
  return kind === "OPEN" || kind === "WON"
}

// ─── Project natures ─────────────────────────────────────────────────────────

/**
 * A tenant-managed project nature: a short stable CODE used as the PROJECTNATURE
 * segment of a project code ({YYYY}-{Entity}-{Account}-{ProjectNature}-{NNN}),
 * plus a human-readable display NAME.
 */
export type ProjectNature = { code: string; name: string }

/** Max length for a project-nature code (keeps project codes short). */
export const PROJECT_NATURE_CODE_MAX = 8

/** Trim + uppercase a project-nature code for storage/comparison. */
export function normalizeProjectNatureCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

/**
 * Validate a normalized project-nature code. Returns an error message, or null
 * when valid. A valid code is non-empty, at most PROJECT_NATURE_CODE_MAX chars,
 * and made of uppercase letters and digits only (so it is safe in a code).
 */
export function validateProjectNatureCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PROJECT_NATURE_CODE_MAX) {
    return `Code must be ${PROJECT_NATURE_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    return "Code must be uppercase letters and digits only."
  }
  return null
}

// ─── Product codes ───────────────────────────────────────────────────────────

/** A tenant-managed product subcategory. */
export type ProductSubcategory = { code: string; name: string }

/** A tenant-managed product category with dependent subcategories. */
export type ProductCategory = {
  code: string
  name: string
  subcategories: ProductSubcategory[]
}

/** Compatibility name for callers that deal with the product taxonomy. */
export type ProductCode = ProductCategory

/** Max length for a product code. */
export const PRODUCT_CODE_MAX = 16
export const PRODUCT_SUBCATEGORY_CODE_MAX = 32

export const QUOTE_DEFAULT_NOTES_MAX = 2000
export const QUOTE_DEFAULT_DELIVERY_MAX = 500
export const QUOTE_DEFAULT_PAYMENT_TERM_MAX = 120

/** Trim + uppercase a product code for storage/comparison. */
export function normalizeProductCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

/**
 * Validate a normalized product code. Returns an error message, or null when
 * valid. A valid code is non-empty, at most PRODUCT_CODE_MAX chars, and made of
 * uppercase letters, digits, hyphen or underscore.
 */
export function validateProductCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PRODUCT_CODE_MAX) {
    return `Code must be ${PRODUCT_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return "Code must be uppercase letters, digits, hyphen or underscore."
  }
  return null
}

export function normalizeProductSubcategoryCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase()
}

export function validateProductSubcategoryCode(code: string): string | null {
  if (code.length === 0) return "Code is required."
  if (code.length > PRODUCT_SUBCATEGORY_CODE_MAX) {
    return `Code must be ${PRODUCT_SUBCATEGORY_CODE_MAX} characters or fewer.`
  }
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return "Code must be uppercase letters, digits, hyphen or underscore."
  }
  return null
}

/** Normalize and validate the complete nested taxonomy sent by Settings. */
export function normalizeProductCategories(
  categories: ProductCategory[]
): ProductCategory[] {
  const cleaned: ProductCategory[] = []
  const categoryCodes = new Set<string>()

  for (const raw of categories ?? []) {
    const code = normalizeProductCode(raw?.code ?? "")
    const name = (raw?.name ?? "").trim()
    const codeError = validateProductCode(code)
    if (codeError) throw new Error(codeError)
    if (!name) throw new Error(`Name is required for product category "${code}".`)
    if (categoryCodes.has(code)) {
      throw new Error(`Duplicate product category code "${code}".`)
    }
    categoryCodes.add(code)

    const subcategories: ProductSubcategory[] = []
    const subcategoryCodes = new Set<string>()
    for (const rawSubcategory of raw?.subcategories ?? []) {
      const subcategoryCode = normalizeProductSubcategoryCode(
        rawSubcategory?.code ?? ""
      )
      const subcategoryName = (rawSubcategory?.name ?? "").trim()
      const subcategoryError = validateProductSubcategoryCode(subcategoryCode)
      if (subcategoryError) throw new Error(subcategoryError)
      if (!subcategoryName) {
        throw new Error(
          `Name is required for subcategory "${subcategoryCode}".`
        )
      }
      if (subcategoryCodes.has(subcategoryCode)) {
        throw new Error(
          `Duplicate subcategory code "${subcategoryCode}" in category "${code}".`
        )
      }
      subcategoryCodes.add(subcategoryCode)
      subcategories.push({ code: subcategoryCode, name: subcategoryName })
    }

    subcategories.sort((a, b) => a.code.localeCompare(b.code))
    cleaned.push({ code, name, subcategories })
  }

  cleaned.sort((a, b) => a.code.localeCompare(b.code))
  return cleaned
}

/** Validate the dependent category/subcategory pair stored on a Product. */
export function validateProductTaxonomyPair(
  categories: ProductCategory[],
  productCode: string | null | undefined,
  subcategory: string | null | undefined
): { productCode: string | null; subcategory: string | null } {
  const categoryCode = productCode ? normalizeProductCode(productCode) : null
  const subcategoryCode = subcategory
    ? normalizeProductSubcategoryCode(subcategory)
    : null

  if (!categoryCode && subcategoryCode) {
    throw new Error("A subcategory requires a product category.")
  }
  if (!categoryCode) return { productCode: null, subcategory: null }

  const category = categories.find((candidate) => candidate.code === categoryCode)
  if (!category) {
    throw new Error(`Product category "${categoryCode}" is not configured.`)
  }
  if (!subcategoryCode) return { productCode: category.code, subcategory: null }

  const child = category.subcategories.find(
    (candidate) => candidate.code === subcategoryCode
  )
  if (!child) {
    throw new Error(
      `Subcategory "${subcategoryCode}" does not belong to product category "${categoryCode}".`
    )
  }
  return { productCode: category.code, subcategory: child.code }
}

export type ProductTaxonomyReference = {
  productCode: string | null
  subcategory: string | null
}

/** Block removal of category or subcategory values used by live Products. */
export function assertTaxonomyRemovalsSafe(
  previous: ProductCategory[],
  next: ProductCategory[],
  references: ProductTaxonomyReference[]
): void {
  const nextCategories = new Map(next.map((category) => [category.code, category]))
  for (const reference of references) {
    const categoryCode = reference.productCode
      ? normalizeProductCode(reference.productCode)
      : null
    const subcategoryCode = reference.subcategory
      ? normalizeProductSubcategoryCode(reference.subcategory)
      : null
    if (!categoryCode) continue

    const category = nextCategories.get(categoryCode)
    if (!category) {
      throw new Error(`Product category "${categoryCode}" is in use.`)
    }
    if (
      subcategoryCode &&
      !category.subcategories.some((child) => child.code === subcategoryCode)
    ) {
      throw new Error(`Subcategory "${subcategoryCode}" is in use.`)
    }
  }

  // Keep the previous argument in the contract so callers can make the
  // removal check explicit, while the live references remain authoritative.
  void previous
}

export type QuoteDefaults = {
  notes: string
  delivery: string
  paymentTerm: string
}

export function normalizeQuoteDefaults(input: QuoteDefaults): QuoteDefaults {
  const values: QuoteDefaults = {
    notes: (input.notes ?? "").trim(),
    delivery: (input.delivery ?? "").trim(),
    paymentTerm: (input.paymentTerm ?? "").trim(),
  }
  const limits: Array<[keyof QuoteDefaults, number]> = [
    ["notes", QUOTE_DEFAULT_NOTES_MAX],
    ["delivery", QUOTE_DEFAULT_DELIVERY_MAX],
    ["paymentTerm", QUOTE_DEFAULT_PAYMENT_TERM_MAX],
  ]
  for (const [field, max] of limits) {
    if (values[field].length > max) {
      throw new Error(`Quote default ${field} must be ${max} characters or fewer.`)
    }
  }
  return values
}
