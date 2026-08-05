export type CollectionFrequency = "monthly" | "upfront"

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid billing date.")
  }
  return date
}

export function addCalendarMonths(value: string, months: number): string {
  const date = parseDateOnly(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

/** Inclusive contract dates expressed as monthly billing periods. */
export function countMonthlyBillingPeriods(startsAt: string, endsAt: string): number {
  const start = parseDateOnly(startsAt)
  const end = parseDateOnly(endsAt)
  if (start > end) return 0
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() - start.getUTCMonth()
  if (parseDateOnly(addCalendarMonths(startsAt, months)) <= end) months += 1
  return Math.max(1, months)
}

export function calculateContractTotal(
  monthlySeatPrice: number,
  seats: number,
  billingPeriods: number,
  taxRate: number
) {
  const subtotal = Math.round(monthlySeatPrice * seats * billingPeriods * 100) / 100
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
  return { subtotal, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 }
}

export type CollectionMilestone = {
  sequence: number
  title: string
  dueAt: string
  amount: number
}

export function buildCollectionMilestones(input: {
  frequency: CollectionFrequency
  billingPeriods: number
  firstDueAt: string
  total: number
}): CollectionMilestone[] {
  const count = input.frequency === "monthly" ? input.billingPeriods : 1
  if (!Number.isInteger(count) || count < 1) return []
  const totalCents = Math.round(input.total * 100)
  const baseCents = Math.floor(totalCents / count)
  let allocatedCents = 0

  return Array.from({ length: count }, (_, index) => {
    const cents = index === count - 1 ? totalCents - allocatedCents : baseCents
    allocatedCents += cents
    return {
      sequence: index + 1,
      title: input.frequency === "monthly" ? `Month ${index + 1} collection` : "Contract collection",
      dueAt: addCalendarMonths(input.firstDueAt, index),
      amount: cents / 100,
    }
  })
}
