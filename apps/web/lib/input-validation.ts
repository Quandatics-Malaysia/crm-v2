const MONEY_RE = /^\d+(?:\.\d{1,2})?$/
const YEAR_RE = /^\d{4}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function trimOrEmpty(value: string | null | undefined): string {
  return (value ?? "").trim()
}

/** Check whether a free-form numeric string is a non-negative amount with up to 2 decimals. */
export function isValidMoneyInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return false
  if (!MONEY_RE.test(v)) return false
  const n = Number(v)
  return Number.isFinite(n) && n >= 0
}

export function normalizeMoneyInput(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (!isValidMoneyInput(v)) {
    throw new Error(`${fieldLabel} must be a non-negative number with up to 2 decimals (e.g. 1200.50).`)
  }
  return v
}

/** Check whether an `YYYY-MM-DD` date string is valid and normalized to calendar date. */
export function isValidDateInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

export function normalizeDateInput(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (!isValidDateInput(v)) {
    throw new Error(`${fieldLabel} must be a valid date in YYYY-MM-DD format.`)
  }
  return v
}

/** Check whether a year is a 4-digit whole number (1000-9999). */
export function isValidYearInput(value: string | number): boolean {
  const v = trimOrEmpty(String(value))
  if (!YEAR_RE.test(v)) return false
  const n = Number(v)
  return Number.isInteger(n) && n >= 1000 && n <= 9999
}

export function normalizeYearInput(
  value: string | number | null | undefined,
  fieldLabel: string
): number | null {
  if (value === undefined || value === null) return null
  const v = trimOrEmpty(String(value))
  if (!v) return null
  if (!isValidYearInput(v)) {
    throw new Error(`${fieldLabel} must be a 4-digit year (e.g. 2026).`)
  }
  return Number(v)
}

export function isValidPercentInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return false
  if (!isValidMoneyInput(v)) return false
  const n = Number(v)
  return n >= 0 && n <= 100
}
