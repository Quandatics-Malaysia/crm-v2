import { z } from "zod"
import { computeQuotation } from "@/server/services/quotation-math"

/**
 * Shared, server-enforced numeric validation for quotation line items + header
 * discount. Reused by the quotation forms (client parity) and asserted again in
 * createQuotation/updateQuotation so the persisted totals can never go negative.
 *
 * Lines are kept as strings (the forms bind raw <input> values); each refine
 * coerces with Number() and rejects NaN / out-of-range values.
 */
const isNumber = (v: string) => v.trim() !== "" && Number.isFinite(Number(v))

/** qty ≥ 0, unitPrice ≥ 0, 0 ≤ discountPercent ≤ 100. */
export const quotationLineSchema = z.object({
  description: z.string().trim().min(1, "Required"),
  quantity: z
    .string()
    .trim()
    .min(1, "Required")
    .refine((v) => isNumber(v) && Number(v) >= 0, "Qty must be 0 or more"),
  unitPrice: z
    .string()
    .trim()
    .min(1, "Required")
    .refine((v) => isNumber(v) && Number(v) >= 0, "Unit price must be 0 or more"),
  discountPercent: z
    .string()
    .trim()
    .refine(
      (v) => v.trim() === "" || (isNumber(v) && Number(v) >= 0 && Number(v) <= 100),
      "Discount must be between 0 and 100%"
    ),
})

/** headerDiscount ≥ 0 (the ≤ subtotal bound is checked against the lines). */
export const headerDiscountSchema = z
  .string()
  .trim()
  .refine(
    (v) => v.trim() === "" || (isNumber(v) && Number(v) >= 0),
    "Header discount must be 0 or more"
  )

export type QuotationNumbersInput = {
  headerDiscount?: string | null
  lines: {
    quantity: number | string
    unitPrice: number | string
    discountPercent?: number | string
  }[]
  ratePercent?: number | string
  taxInclusive?: boolean
}

/**
 * Server-side guard. Throws a user-facing Error on the first invalid value so
 * the action (wrapped by runAction) surfaces it as `{ ok: false, error }`.
 * Empty line arrays are allowed (a draft can be created before any lines exist).
 */
export function assertValidQuotationNumbers(input: QuotationNumbersInput): void {
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i]
    const qty = Number(l.quantity)
    const price = Number(l.unitPrice)
    const disc = Number(l.discountPercent ?? 0)
    if (!Number.isFinite(qty) || qty < 0)
      throw new Error(`Line ${i + 1}: quantity must be 0 or more`)
    if (!Number.isFinite(price) || price < 0)
      throw new Error(`Line ${i + 1}: unit price must be 0 or more`)
    if (!Number.isFinite(disc) || disc < 0 || disc > 100)
      throw new Error(`Line ${i + 1}: discount must be between 0 and 100%`)
  }

  const headerDiscount = Number(input.headerDiscount ?? 0)
  if (!Number.isFinite(headerDiscount) || headerDiscount < 0)
    throw new Error("Header discount must be 0 or more")

  const { subtotal } = computeQuotation({
    lines: input.lines,
    ratePercent: input.ratePercent ?? 0,
    headerDiscount: 0,
    taxInclusive: input.taxInclusive,
  })
  if (headerDiscount > subtotal + 0.0001)
    throw new Error("Header discount cannot exceed the subtotal")
}
