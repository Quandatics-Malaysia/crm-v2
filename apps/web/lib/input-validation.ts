const MONEY_RE = /^\d+(?:\.\d{1,2})?$/
const YEAR_RE = /^\d{4}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const PHONE_RE = /^[+]?[(]?[0-9]{0,3}[)]?[-\s./0-9]{5,}$/

function trimOrEmpty(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function isValidEmailInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export function isValidPhoneInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return true
  if (v.length > 64) return false
  // Must be shaped like a phone number and carry enough real digits to stand up.
  // This closes the gap where the UI's E.164 check rejects "12345" but the old
  // regex accepted it — while still tolerating national-format input (no "+").
  if (!PHONE_RE.test(v)) return false
  const digits = v.replace(/\D/g, "")
  return digits.length >= 6
}

export function isValidUrlInput(value: string): boolean {
  const v = trimOrEmpty(value)
  if (!v) return true
  try {
    const parsed = new URL(v)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
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

export function normalizeEmailInput(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (!isValidEmailInput(v)) {
    throw new Error(`${fieldLabel} must be a valid email address.`)
  }
  return v
}

export function normalizePhoneInput(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (!isValidPhoneInput(v)) {
    throw new Error(`${fieldLabel} must be a valid phone number.`)
  }
  return v
}

export function normalizeUrlInput(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (!isValidUrlInput(v)) {
    throw new Error(`${fieldLabel} must be a valid http or https URL.`)
  }
  return v
}

export function normalizeTextInput(
  value: string | null | undefined,
  fieldLabel: string,
  maxLength = 1000
): string | null {
  const v = trimOrEmpty(value)
  if (!v) return null
  if (v.length > maxLength) {
    throw new Error(`${fieldLabel} is too long (max ${maxLength} characters).`)
  }
  return v
}

/** Check a tenant-defined custom field value against its configured type. */
export function isValidCustomFieldValue(
  value: string,
  type: "text" | "number" | "date" | "checkbox" | "select",
  options: string[] = []
): boolean {
  const v = trimOrEmpty(value)
  if (!v) return true
  if (type === "number") return isValidMoneyInput(v)
  if (type === "date") return isValidDateInput(v)
  if (type === "checkbox") return v === "true" || v === "false"
  if (type === "select") return options.includes(v)
  return true
}

/** Normalize + validate a tenant-defined custom field value. */
export function normalizeCustomFieldValue(
  value: string,
  type: "text" | "number" | "date" | "checkbox" | "select",
  options: string[] = [],
  fieldLabel: string
): string {
  const v = trimOrEmpty(value)
  if (type === "checkbox" && !v) return ""
  if (!isValidCustomFieldValue(v, type, options)) {
    if (type === "number") {
      throw new Error(`${fieldLabel} must be a valid number.`)
    }
    if (type === "date") {
      throw new Error(`${fieldLabel} must be a valid date (YYYY-MM-DD).`)
    }
    if (type === "checkbox") {
      throw new Error(`${fieldLabel} must be "true" or "false".`)
    }
    if (type === "select") {
      throw new Error(`${fieldLabel} must be one of: ${options.join(", ") || "an allowed option"}.`)
    }
    throw new Error(`${fieldLabel} is invalid.`)
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
