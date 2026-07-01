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

/** qty ≥ 0, unitPrice ≥ 0, discountAmount ≥ 0 (absolute money, ≤ line total). */
export const quotationLineSchema = z.object({
  /** Optional link to a catalog product the line was created from. */
  productId: z.string().optional(),
  /** Unit of measure (filled from the product, editable). */
  uom: z.string().optional(),
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
  discountAmount: z
    .string()
    .trim()
    .refine(
      (v) => v.trim() === "" || (isNumber(v) && Number(v) >= 0),
      "Discount must be 0 or more"
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
    discountAmount?: number | string
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
    const disc = Number(l.discountAmount ?? 0)
    if (!Number.isFinite(qty) || qty < 0)
      throw new Error(`Line ${i + 1}: quantity must be 0 or more`)
    if (!Number.isFinite(price) || price < 0)
      throw new Error(`Line ${i + 1}: unit price must be 0 or more`)
    if (!Number.isFinite(disc) || disc < 0)
      throw new Error(`Line ${i + 1}: discount must be 0 or more`)
    if (disc > qty * price + 0.0001)
      throw new Error(`Line ${i + 1}: discount can't exceed the line total`)
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
