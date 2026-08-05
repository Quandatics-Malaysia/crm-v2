export function calculateProrationFraction(input: {
  startsAt: Date | null
  endsAt: Date | null
  now?: Date
}): number {
  const { startsAt, endsAt } = input
  const now = input.now ?? new Date()
  if (startsAt && endsAt && endsAt > startsAt) {
    const total = endsAt.getTime() - startsAt.getTime()
    const remaining = Math.max(0, endsAt.getTime() - now.getTime())
    return Math.min(1, remaining / total)
  }
  return 1
}

export function calculateProratedSeatCharge(input: {
  seatPrice: number
  additionalSeats: number
  startsAt: Date | null
  endsAt: Date | null
  now?: Date
}): number {
  const { seatPrice, additionalSeats } = input
  if (seatPrice < 0 || additionalSeats < 1) return 0
  const fraction = calculateProrationFraction(input)
  return Math.round(seatPrice * additionalSeats * fraction * 100) / 100
}
