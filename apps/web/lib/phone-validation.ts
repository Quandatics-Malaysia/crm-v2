import {
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumber,
} from "react-phone-number-input"

export type PhoneCountryCode = Parameters<typeof isValidPhoneNumber>[1]

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  malaysia: "MY",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  britain: "GB",
  australia: "AU",
  singapore: "SG",
  india: "IN",
  indonesia: "ID",
  thailand: "TH",
  philippines: "PH",
  vietnam: "VN",
  china: "CN",
  "hong kong": "HK",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  taiwan: "TW",
  "united arab emirates": "AE",
  uae: "AE",
  "saudi arabia": "SA",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  belgium: "BE",
  switzerland: "CH",
  italy: "IT",
  spain: "ES",
  portugal: "PT",
  poland: "PL",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  austria: "AT",
  ireland: "IE",
  "new zealand": "NZ",
  canada: "CA",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  "south africa": "ZA",
  egypt: "EG",
  nigeria: "NG",
  kenya: "KE",
}

/** Convert an ISO code or account/display country name to a libphonenumber ISO code. */
export function normalizePhoneCountry(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim()
  if (!raw) return undefined
  const candidate = raw.toUpperCase()
  if (/^[A-Z]{2}$/.test(candidate) && isSupportedCountry(candidate)) return candidate
  const name = raw.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim()
  return COUNTRY_NAME_ALIASES[name]
}

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
    const normalizedCountry = normalizePhoneCountry(country) ?? "MY"
    return isValidPhoneNumber(v, normalizedCountry as PhoneCountryCode)
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
    const normalizedCountry = normalizePhoneCountry(country) ?? "MY"
    return parsePhoneNumber(v, normalizedCountry as PhoneCountryCode)?.number ?? v
  } catch {
    return v
  }
}
