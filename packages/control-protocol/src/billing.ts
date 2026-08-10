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
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

/** Inclusive contract dates expressed as monthly billing periods. */
export function countMonthlyBillingPeriods(startsAt: string, endsAt: string): number {
  return getMonthlyBillingPeriods(startsAt, endsAt).length
}

export type MonthlyBillingPeriod = {
  startsAt: string
  endsAt: string
  factor: number
}

function dayBefore(value: string): string {
  const date = parseDateOnly(value)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function inclusiveDays(startsAt: string, endsAt: string): number {
  return (
    Math.round(
      (parseDateOnly(endsAt).getTime() - parseDateOnly(startsAt).getTime()) / 86_400_000,
    ) + 1
  )
}

/** Monthly cycles anchored to the contract start; the final partial cycle is prorated by days. */
export function getMonthlyBillingPeriods(
  startsAt: string,
  endsAt: string,
): MonthlyBillingPeriod[] {
  if (parseDateOnly(startsAt) > parseDateOnly(endsAt)) return []
  const periods: MonthlyBillingPeriod[] = []
  for (let index = 0; index < 1200; index += 1) {
    const periodStart = addCalendarMonths(startsAt, index)
    if (parseDateOnly(periodStart) > parseDateOnly(endsAt)) break
    const nextStart = addCalendarMonths(startsAt, index + 1)
    const fullPeriodEnd = dayBefore(nextStart)
    const periodEnd =
      parseDateOnly(endsAt) < parseDateOnly(fullPeriodEnd) ? endsAt : fullPeriodEnd
    periods.push({
      startsAt: periodStart,
      endsAt: periodEnd,
      factor:
        inclusiveDays(periodStart, periodEnd) / inclusiveDays(periodStart, fullPeriodEnd),
    })
  }
  return periods
}

export function calculateContractTotal(
  monthlySeatPrice: number,
  seats: number,
  billingFactor: number,
  taxRate: number,
) {
  const subtotal = Math.round(monthlySeatPrice * seats * billingFactor * 100) / 100
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
  weights?: number[]
}): CollectionMilestone[] {
  const count = input.frequency === "monthly" ? input.billingPeriods : 1
  if (!Number.isInteger(count) || count < 1) return []
  const totalCents = Math.round(input.total * 100)
  const weights =
    input.frequency === "monthly" && input.weights?.length === count
      ? input.weights
      : Array.from({ length: count }, () => 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let allocatedCents = 0

  return Array.from({ length: count }, (_, index) => {
    const cents =
      index === count - 1
        ? totalCents - allocatedCents
        : Math.round(totalCents * (weights[index] / totalWeight))
    allocatedCents += cents
    return {
      sequence: index + 1,
      title:
        input.frequency === "monthly" ? `Month ${index + 1} collection` : "Contract collection",
      dueAt: addCalendarMonths(input.firstDueAt, index),
      amount: cents / 100,
    }
  })
}
