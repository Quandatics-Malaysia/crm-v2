import { describe, expect, it } from "vitest"
import { reminderStageDue, daysOverdue } from "@/lib/reminders"

const D = (s: string) => new Date(`${s}T12:00:00`)

describe("reminderStageDue", () => {
  const schedule = [7, 14, 30]

  it("is 0 before the first threshold", () => {
    expect(reminderStageDue("2026-07-01", schedule, D("2026-07-01"))).toBe(0)
    expect(reminderStageDue("2026-07-01", schedule, D("2026-07-07"))).toBe(0)
  })

  it("crosses each threshold on its day", () => {
    expect(reminderStageDue("2026-07-01", schedule, D("2026-07-08"))).toBe(1)
    expect(reminderStageDue("2026-07-01", schedule, D("2026-07-15"))).toBe(2)
    expect(reminderStageDue("2026-07-01", schedule, D("2026-07-31"))).toBe(3)
    expect(reminderStageDue("2026-07-01", schedule, D("2027-01-01"))).toBe(3)
  })

  it("handles no due date, empty schedule, garbage dates", () => {
    expect(reminderStageDue(null, schedule, D("2026-07-31"))).toBe(0)
    expect(reminderStageDue("2026-07-01", [], D("2026-07-31"))).toBe(0)
    expect(reminderStageDue("not-a-date", schedule, D("2026-07-31"))).toBe(0)
  })
})

describe("daysOverdue", () => {
  it("counts whole days past due, clamped at 0", () => {
    expect(daysOverdue("2026-07-01", D("2026-07-10"))).toBe(9)
    expect(daysOverdue("2026-07-01", D("2026-06-01"))).toBe(0)
    expect(daysOverdue(null, D("2026-07-10"))).toBe(0)
  })
})
