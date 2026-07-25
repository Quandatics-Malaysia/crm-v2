/**
 * Intercompany profit-split math (absolute-value model).
 *
 * A deal's handling partner charges its upstream a fixed ABSOLUTE amount (the
 * "leg amount"). When the upstream issues an invoice for a slice of the deal,
 * the partner's mirrored share is that slice's proportion of the leg — so N
 * partial invoices sum back to exactly the leg. Percentage mode (legacy) is kept
 * for deals authored the old way. Pure + unit-tested: the money path.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The partner's share of a single origin invoice.
 * - Absolute mode (`legAmount` set): `legAmount × invoiceAmount / dealTotal`,
 *   capped at `legAmount` so we never mirror more than the leg. With no basis
 *   (`dealTotal ≤ 0`) the invoice is treated as the whole leg.
 *   // ponytail: zero-basis falls back to the full leg — only wrong for a
 *   // multi-invoice deal with no quote/estimate; author a value to fix.
 * - Percent mode (`legAmount` null, `recognizedPercent` set): the original
 *   `invoiceAmount × (100 − recognizedPercent) / 100` — byte-identical to before.
 * Returns 0 when nothing is derivable (both null) or the share is non-positive.
 */
export function intercoShare(i: {
  legAmount: number | null
  recognizedPercent: number | null
  dealTotal: number
  invoiceAmount: number
}): number {
  let share: number
  if (i.legAmount != null) {
    share =
      i.dealTotal > 0
        ? (i.legAmount * i.invoiceAmount) / i.dealTotal
        : i.legAmount
    share = Math.min(share, i.legAmount)
  } else if (i.recognizedPercent != null) {
    const pct = Math.max(0, 100 - i.recognizedPercent)
    share = (i.invoiceAmount * pct) / 100
  } else {
    return 0
  }
  return share > 0 ? round2(share) : 0
}

/**
 * The origin's recognized cut (%) implied by an absolute partner leg amount:
 * `(basis − leg) / basis`, clamped to [0,100]. Kept as a derived cache so the
 * existing percent-based forecast + "Recognized" displays keep working when a
 * deal is authored by absolute leg amount. `null` when there's no basis yet.
 */
export function deriveRecognizedPercent(
  basis: number,
  legAmount: number
): number | null {
  if (!(basis > 0)) return null
  const pct = ((basis - legAmount) / basis) * 100
  return Math.min(100, Math.max(0, round2(pct)))
}

/**
 * A deal can be split across at most this many partner entities. 10 is well
 * above a 3-tier chain (e.g. QM→CC→QAW) — such chains work as soon as 3+
 * entities exist in the group; there is no code-level tier limit. External
 * (non-entity) suppliers are captured separately as deal costs (see
 * cost-actions.ts / CostsPanel), not as parties, so they reduce the true margin
 * without being folded into the origin's recognized cut.
 */
export const MAX_INTERCOMPANY_PARTIES = 10

export type PartyShare = {
  partnerEntityId: string
  shareType: "percent" | "amount"
  shareValue: number
}

/**
 * One party's OWN share of a single origin invoice — independent of the other
 * parties on the deal (NOT a complement of anyone else's share, unlike legacy
 * percent-mode `intercoShare`). Percent mode: `invoiceAmount × shareValue /
 * 100`. Amount mode: reuses `intercoShare`'s proportional-leg math.
 */
export function partyShare(
  party: Pick<PartyShare, "shareType" | "shareValue">,
  dealTotal: number,
  invoiceAmount: number
): number {
  if (party.shareType === "amount") {
    return intercoShare({
      legAmount: party.shareValue,
      recognizedPercent: null,
      dealTotal,
      invoiceAmount,
    })
  }
  const share = (invoiceAmount * party.shareValue) / 100
  return share > 0 ? round2(share) : 0
}

/**
 * The origin's recognized cut (%) after ALL party shares are taken out —
 * generalizes `deriveRecognizedPercent` to N parties. Amount-mode parties are
 * converted to an effective percent-of-basis first, then summed alongside
 * percent-mode parties. `null` when there's no basis yet.
 *
 * This is a 2-decimal cache (the `recognized_percent` column is numeric(5,2))
 * kept so the percent-based forecast view keeps working; the probability-
 * weighted forecast therefore inherits a sub-cent rounding error. For any
 * exact recognized MONEY figure use `deriveOriginRecognizedAmount` instead.
 */
export function deriveOriginRecognizedPercent(
  basis: number,
  parties: Pick<PartyShare, "shareType" | "shareValue">[]
): number | null {
  if (!(basis > 0)) return null
  const consumedPercent = parties.reduce((sum, p) => {
    const pct =
      p.shareType === "percent" ? p.shareValue : (p.shareValue / basis) * 100
    return sum + pct
  }, 0)
  return Math.min(100, Math.max(0, round2(100 - consumedPercent)))
}

/**
 * The origin's recognized cut as an EXACT money amount: `basis − Σ party
 * shares`, each party's share taken at the full deal basis. Use this for any
 * money display/report instead of `basis × recognizedPercent`, which loses
 * precision because `recognizedPercent` is a 2-decimal round of the split (a
 * fixed RM879,306 leg on a RM1,018,000 deal must yield exactly RM138,694.00,
 * not RM138,651.60). Returns 0 when there's no basis.
 */
export function deriveOriginRecognizedAmount(
  basis: number,
  parties: Pick<PartyShare, "shareType" | "shareValue">[]
): number {
  if (!(basis > 0)) return 0
  const consumed = parties.reduce(
    (sum, p) =>
      sum + partyShare({ shareType: p.shareType, shareValue: p.shareValue }, basis, basis),
    0
  )
  return round2(Math.min(basis, Math.max(0, basis - consumed)))
}

/**
 * Validates a deal's full party list before save: no duplicate partners, no
 * more than MAX_INTERCOMPANY_PARTIES, every share positive, amount-mode legs
 * within the deal total, and percent-mode shares summing to at most 100%
 * (the remainder is the origin's own cut).
 */
export function validatePartyShares(
  parties: PartyShare[],
  dealTotal: number
): { ok: true } | { ok: false; error: string } {
  if (parties.length === 0)
    return { ok: false, error: "At least one party is required." }
  if (parties.length > MAX_INTERCOMPANY_PARTIES)
    return {
      ok: false,
      error: `A deal can have at most ${MAX_INTERCOMPANY_PARTIES} parties.`,
    }

  const seen = new Set<string>()
  let percentTotal = 0
  for (const p of parties) {
    if (seen.has(p.partnerEntityId))
      return {
        ok: false,
        error: "Each partner entity can only appear once on a deal.",
      }
    seen.add(p.partnerEntityId)
    if (!(p.shareValue > 0))
      return { ok: false, error: "Each party's share must be greater than zero." }
    if (p.shareType === "percent") {
      percentTotal += p.shareValue
    } else if (dealTotal > 0 && p.shareValue > dealTotal) {
      return {
        ok: false,
        error: "A party's leg amount can't exceed the deal total.",
      }
    }
  }
  if (percentTotal > 100)
    return { ok: false, error: "Party percentages can't sum to more than 100%." }
  return { ok: true }
}
