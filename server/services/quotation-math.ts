/**
 * Pure quotation totals. Single quote-level tax rate (per-line override is a
 * future enhancement). Net-of-tax `subtotal − discountTotal` is the taxable
 * base that the billing-forecast view also reads, keeping the two consistent.
 *
 * Reconciliation invariant (BOTH tax modes):
 *   subtotal + taxTotal − discountTotal === total
 * and the persisted per-line breakdown reconciles to the header:
 *   Σ lineSubtotal === subtotal   (pre-header-discount net)
 *   Σ lineTax      === taxTotal
 *   Σ lineTotal    === total       (post-header-discount, incl. tax)
 * The header discount is allocated pro-rata across lines (folded into each
 * line's tax/total), with rounding remainders absorbed by the last line.
 */
export type LineInput = {
  quantity: number | string
  unitPrice: number | string
  discountAmount?: number | string
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

  // Net (ex-tax) base of each line, before the header discount. In tax-inclusive
  // mode the entered price already contains tax, so divide it out.
  const netBases = opts.lines.map((l) => {
    const gross = num(l.quantity) * num(l.unitPrice)
    // Absolute per-line discount, clamped so a line never goes negative.
    const afterDisc = Math.max(0, gross - num(l.discountAmount))
    return taxInclusive ? afterDisc / (1 + rate) : afterDisc
  })

  const subtotalRaw = netBases.reduce((s, b) => s + b, 0)
  const subtotal = round2(subtotalRaw)
  // Clamp the header discount into [0, subtotal] so totals never go negative.
  // (createQuotation/updateQuotation reject out-of-range values up front.)
  const discountTotal = round2(
    Math.min(Math.max(num(opts.headerDiscount), 0), subtotal)
  )
  const taxableBase = round2(subtotal - discountTotal)
  const taxTotal = round2(taxableBase * rate)
  const total = round2(taxableBase + taxTotal)

  // Pro-rata factor mapping each line's pre-discount net onto the post-discount
  // taxable base (1 when there is no header discount).
  const factor = subtotalRaw > 0 ? (subtotalRaw - discountTotal) / subtotalRaw : 0

  const lines: LineComputed[] = netBases.map((base) => {
    const netAfter = base * factor
    const lineTax = round2(netAfter * rate)
    return {
      lineSubtotal: round2(base),
      lineTax,
      lineTotal: round2(netAfter + lineTax),
    }
  })

  // Absorb rounding drift on the last line so the per-line sums reconcile
  // exactly to the header subtotal / taxTotal / total.
  if (lines.length > 0) {
    const last = lines[lines.length - 1]
    const sumSub = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0))
    const sumTax = round2(lines.reduce((s, l) => s + l.lineTax, 0))
    const sumTot = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    last.lineSubtotal = round2(last.lineSubtotal + (subtotal - sumSub))
    last.lineTax = round2(last.lineTax + (taxTotal - sumTax))
    last.lineTotal = round2(last.lineTotal + (total - sumTot))
  }

  // Sanity check: the same grand total must reconcile in both tax modes.
  if (Math.abs(subtotal + taxTotal - discountTotal - total) > 0.02) {
    throw new Error("Quotation totals failed to reconcile")
  }

  return { subtotal, discountTotal, taxTotal, total, lines }
}
