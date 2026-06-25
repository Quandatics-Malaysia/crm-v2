/**
 * Pure quotation totals. Single quote-level tax rate (per-line override is a
 * future enhancement). Net-of-tax `subtotal − discountTotal` is the taxable
 * base that the billing-forecast view also reads, keeping the two consistent.
 */
export type LineInput = {
  quantity: number | string
  unitPrice: number | string
  discountPercent?: number | string
}

export type LineComputed = {
  lineSubtotal: number
  lineTax: number
  lineTotal: number
}

export type QuoteTotals = {
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  lines: LineComputed[]
}

function num(v: number | string | null | undefined): number {
  const x = typeof v === "string" ? parseFloat(v) : (v ?? 0)
  return Number.isFinite(x) ? (x as number) : 0
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeQuotation(opts: {
  lines: LineInput[]
  ratePercent?: number | string
  headerDiscount?: number | string
  taxInclusive?: boolean
}): QuoteTotals {
  const rate = num(opts.ratePercent) / 100
  const taxInclusive = !!opts.taxInclusive

  const lines: LineComputed[] = opts.lines.map((l) => {
    const gross = num(l.quantity) * num(l.unitPrice)
    const afterDisc = gross * (1 - num(l.discountPercent) / 100)
    if (taxInclusive) {
      const lineTotal = round2(afterDisc)
      const lineSubtotal = round2(afterDisc / (1 + rate))
      return { lineSubtotal, lineTax: round2(lineTotal - lineSubtotal), lineTotal }
    }
    const lineSubtotal = round2(afterDisc)
    const lineTax = round2(afterDisc * rate)
    return { lineSubtotal, lineTax, lineTotal: round2(lineSubtotal + lineTax) }
  })

  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0))
  const discountTotal = round2(num(opts.headerDiscount))
  const taxableBase = round2(subtotal - discountTotal)

  if (taxInclusive) {
    const taxTotal = round2(lines.reduce((s, l) => s + l.lineTax, 0))
    return { subtotal, discountTotal, taxTotal, total: round2(subtotal - discountTotal), lines }
  }

  const taxTotal = round2(taxableBase * rate)
  return { subtotal, discountTotal, taxTotal, total: round2(taxableBase + taxTotal), lines }
}
