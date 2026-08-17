export type TextFilterOperator = "contains" | "equals" | "starts-with"
export type NumericFilterOperator =
  | "equals"
  | "greater-than"
  | "less-than"
  | "between"
export type DateFilterOperator = "on" | "before" | "after" | "between"

export interface DataTableFilterOption {
  value: string
  label: string
}

interface DataTableFilterMetadata<TOperator extends string = string> {
  columnId: string
  title?: string
  label?: string
  operators?: readonly TOperator[]
}

export type DataTableFilterDefinition =
  | (DataTableFilterMetadata<TextFilterOperator> & { type: "text" })
  | (DataTableFilterMetadata<NumericFilterOperator> & { type: "number" })
  | (DataTableFilterMetadata<NumericFilterOperator> & { type: "money" })
  | (DataTableFilterMetadata<DateFilterOperator> & { type: "date" })
  | (DataTableFilterMetadata & { type: "boolean" })
  | (DataTableFilterMetadata & {
      type: "enum"
      options: readonly DataTableFilterOption[]
    })
  | (DataTableFilterMetadata & {
      type: "relation"
      options: readonly DataTableFilterOption[]
    })

export type DataTableFilterValue =
  | {
      type: "text"
      operator: TextFilterOperator
      value?: string | null
    }
  | {
      type: "number"
      operator: NumericFilterOperator
      value?: number | null
      min?: number | null
      max?: number | null
    }
  | {
      type: "money"
      operator: NumericFilterOperator
      value?: number | null
      min?: number | null
      max?: number | null
    }
  | {
      type: "date"
      operator: DateFilterOperator
      value?: string | null
      from?: string | null
      to?: string | null
    }
  | { type: "boolean"; value?: boolean | null }
  | { type: "enum"; value?: readonly string[] | null }
  | { type: "relation"; value?: string | readonly string[] | null }

export type FilterValidationResult =
  | { success: true; value: DataTableFilterValue }
  | { success: false; error: string }

const TEXT_OPERATORS: readonly TextFilterOperator[] = [
  "contains",
  "equals",
  "starts-with",
]
const NUMERIC_OPERATORS: readonly NumericFilterOperator[] = [
  "equals",
  "greater-than",
  "less-than",
  "between",
]
const DATE_OPERATORS: readonly DateFilterOperator[] = [
  "on",
  "before",
  "after",
  "between",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function calendarDateNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number)
  return Date.UTC(year, month - 1, day)
}

function validateNumericFilter(
  value: Record<string, unknown>,
  type: "number" | "money"
): FilterValidationResult {
  const operator = value.operator
  if (!NUMERIC_OPERATORS.includes(operator as NumericFilterOperator)) {
    return { success: false, error: `Invalid ${type} operator.` }
  }

  if (operator === "between") {
    const min = value.min
    const max = value.max
    if (isEmpty(min) && isEmpty(max)) {
      return { success: true, value: value as DataTableFilterValue }
    }
    if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
      return { success: false, error: `${type} range must contain finite numbers.` }
    }
    if (min > max) return { success: false, error: `${type} range is inverted.` }
    return { success: true, value: value as DataTableFilterValue }
  }

  if (isEmpty(value.value)) {
    return { success: true, value: value as DataTableFilterValue }
  }
  if (!isFiniteNumber(value.value)) {
    return { success: false, error: `${type} value must be finite.` }
  }
  return { success: true, value: value as DataTableFilterValue }
}

export function validateFilterValue(value: unknown): FilterValidationResult {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { success: false, error: "Filter must be an object with a type." }
  }

  switch (value.type) {
    case "text": {
      if (!TEXT_OPERATORS.includes(value.operator as TextFilterOperator)) {
        return { success: false, error: "Invalid text operator." }
      }
      if (!isEmpty(value.value) && typeof value.value !== "string") {
        return { success: false, error: "Text value must be a string." }
      }
      return { success: true, value: value as DataTableFilterValue }
    }
    case "number":
    case "money":
      return validateNumericFilter(value, value.type)
    case "date": {
      if (!DATE_OPERATORS.includes(value.operator as DateFilterOperator)) {
        return { success: false, error: "Invalid date operator." }
      }
      if (value.operator === "between") {
        if (isEmpty(value.from) && isEmpty(value.to)) {
          return { success: true, value: value as DataTableFilterValue }
        }
        if (!isIsoCalendarDate(value.from) || !isIsoCalendarDate(value.to)) {
          return { success: false, error: "Date range must contain ISO calendar dates." }
        }
        if (calendarDateNumber(value.from) > calendarDateNumber(value.to)) {
          return { success: false, error: "Date range is inverted." }
        }
        return { success: true, value: value as DataTableFilterValue }
      }
      if (isEmpty(value.value)) {
        return { success: true, value: value as DataTableFilterValue }
      }
      if (!isIsoCalendarDate(value.value)) {
        return { success: false, error: "Date value must be an ISO calendar date." }
      }
      return { success: true, value: value as DataTableFilterValue }
    }
    case "boolean":
      if (!isEmpty(value.value) && typeof value.value !== "boolean") {
        return { success: false, error: "Boolean value must be true or false." }
      }
      return { success: true, value: value as DataTableFilterValue }
    case "enum":
      if (isEmpty(value.value)) return { success: true, value: value as DataTableFilterValue }
      if (
        !Array.isArray(value.value) ||
        !value.value.every((item) => typeof item === "string")
      ) {
        return { success: false, error: "Enum value must be a list of strings." }
      }
      return { success: true, value: value as DataTableFilterValue }
    case "relation":
      if (isEmpty(value.value)) return { success: true, value: value as DataTableFilterValue }
      if (
        typeof value.value !== "string" &&
        !(Array.isArray(value.value) && value.value.every((item) => typeof item === "string"))
      ) {
        return { success: false, error: "Relation value must be an ID or list of IDs." }
      }
      return { success: true, value: value as DataTableFilterValue }
    default:
      return { success: false, error: "Unknown filter type." }
  }
}

function rowNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rowDate(value: unknown): number | null {
  return isIsoCalendarDate(value) ? calendarDateNumber(value) : null
}

function rowRelationId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (isRecord(value) && (typeof value.id === "string" || typeof value.id === "number")) {
    return String(value.id)
  }
  return null
}

export function matchesFilter(rowValue: unknown, filter: DataTableFilterValue): boolean {
  const validation = validateFilterValue(filter)
  if (!validation.success) return false
  const value = validation.value

  switch (value.type) {
    case "text": {
      if (isEmpty(value.value)) return true
      if (rowValue == null) return false
      const row = String(rowValue).toLocaleLowerCase()
      const expected = String(value.value).trim().toLocaleLowerCase()
      if (value.operator === "equals") return row === expected
      if (value.operator === "starts-with") return row.startsWith(expected)
      return row.includes(expected)
    }
    case "number":
    case "money": {
      if (value.operator === "between" && isEmpty(value.min) && isEmpty(value.max)) return true
      if (value.operator !== "between" && isEmpty(value.value)) return true
      const row = rowNumber(rowValue)
      if (row == null) return false
      if (value.operator === "between") return row >= value.min! && row <= value.max!
      if (value.operator === "equals") return row === value.value
      if (value.operator === "greater-than") return row > value.value!
      return row < value.value!
    }
    case "date": {
      if (value.operator === "between" && isEmpty(value.from) && isEmpty(value.to)) return true
      if (value.operator !== "between" && isEmpty(value.value)) return true
      const row = rowDate(rowValue)
      if (row == null) return false
      if (value.operator === "between") {
        return row >= calendarDateNumber(value.from!) && row <= calendarDateNumber(value.to!)
      }
      const expected = calendarDateNumber(value.value!)
      if (value.operator === "on") return row === expected
      if (value.operator === "before") return row < expected
      return row > expected
    }
    case "boolean":
      if (isEmpty(value.value)) return true
      if (typeof rowValue === "boolean") return rowValue === value.value
      if (rowValue === "true" || rowValue === "false") return (rowValue === "true") === value.value
      return false
    case "enum":
      if (isEmpty(value.value)) return true
      return value.value!.includes(String(rowValue))
    case "relation": {
      if (isEmpty(value.value)) return true
      const id = rowRelationId(rowValue)
      if (id == null) return false
      const expected = Array.isArray(value.value) ? value.value : [value.value]
      return expected.includes(id)
    }
  }
}
