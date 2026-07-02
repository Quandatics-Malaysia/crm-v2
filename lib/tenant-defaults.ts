/**
 * Built-in fallbacks for tenant-configurable picklists. A tenant that has
 * never touched the corresponding Settings card gets these; once configured,
 * `tenant_settings.currencies` / `payment_terms` win.
 */

/** Common ISO-4217 currencies offered in pickers (default is the first). */
export const DEFAULT_CURRENCIES = [
  "MYR",
  "USD",
  "SGD",
  "EUR",
  "GBP",
  "AUD",
  "JPY",
  "CNY",
  "HKD",
  "IDR",
  "THB",
  "PHP",
  "VND",
  "INR",
  "AED",
]

/** Payment terms offered on a sales-order submission. */
export const DEFAULT_PAYMENT_TERMS = [
  "COD",
  "30 days",
  "45 days",
  "60 days",
  "90 days",
]

/** What a sales-order supporting document is identified as. */
export const DEFAULT_SO_DOCUMENT_KINDS = ["SO", "PO", "Other"]

/** Where a lead came from. */
export const DEFAULT_LEAD_SOURCES = [
  "Website",
  "Referral",
  "Event",
  "Cold call",
  "LinkedIn",
  "Partner",
  "Other",
]

/** Why a deal was lost / a lead disqualified (shared list). */
export const DEFAULT_LOSS_REASONS = [
  "Price",
  "No budget",
  "Lost to competitor",
  "Timing",
  "No decision",
  "Wrong fit",
]
