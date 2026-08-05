export function calculateProratedSeatCharge(input: {
  seatPrice: number
  additionalSeats: number
  startsAt: Date | null
  endsAt: Date | null
  now?: Date
}): number {
  const { seatPrice, additionalSeats, startsAt, endsAt } = input
  if (seatPrice < 0 || additionalSeats < 1) return 0
  const now = input.now ?? new Date()
  let fraction = 1
  if (startsAt && endsAt && endsAt > startsAt) {
    const total = endsAt.getTime() - startsAt.getTime()
    const remaining = Math.max(0, endsAt.getTime() - now.getTime())
    fraction = Math.min(1, remaining / total)
  }
  return Math.round(seatPrice * additionalSeats * fraction * 100) / 100
}
