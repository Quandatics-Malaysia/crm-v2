import {
  isValidPhoneNumber,
  parsePhoneNumber,
} from "react-phone-number-input"

export type PhoneCountryCode = Parameters<typeof isValidPhoneNumber>[1]

/**
 * Verify a phone value as a valid international number for the given country.
 *
 * Empty values are considered VALID — callers decide requiredness (a non-empty
 * value must parse, but an empty optional field is fine). This mirrors the live
 * indicator in <PhoneInput>, which also treats empty as valid.
 */
export function isValidPhoneE164(
  value: string | null | undefined,
  country: string = "MY"
): boolean {
  const v = (value ?? "").trim()
  if (!v) return true
  try {
    return isValidPhoneNumber(v, country as PhoneCountryCode)
  } catch {
    return false
  }
}

/**
 * Normalize a phone value to E.164 (+<country><number>), e.g. "012 345 6789"
 * (MY) -> "+60123456789". Falls back to the original value when it cannot be
 * parsed, so it never throws and never silently drops data.
 */
export function toPhoneE164(
  value: string | null | undefined,
  country: string = "MY"
): string {
  const v = (value ?? "").trim()
  if (!v) return ""
  try {
    return parsePhoneNumber(v, country as PhoneCountryCode)?.number ?? v
  } catch {
    return v
  }
}
