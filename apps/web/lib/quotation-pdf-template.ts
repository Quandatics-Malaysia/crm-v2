export type QuotationPdfTemplateKey = "default" | "qar" | "cc"
export type QuotationPdfTemplateCode = string

export const QUOTATION_PDF_TEMPLATE_OPTIONS = [
  { key: "default" as const, label: "Default" },
  { key: "qar" as const, label: "QAR" },
  { key: "cc" as const, label: "CC" },
] as const

const QUOTATION_PDF_TEMPLATE_KEYS = new Set(
  QUOTATION_PDF_TEMPLATE_OPTIONS.map((option) => option.key)
)

export type QuotationPdfTemplateSpec = {
  key: QuotationPdfTemplateKey
  label: string
}

type ResolveQuotationPdfTemplateInput = {
  /** Explicit tenant/account-level template code from settings. */
  rawTemplateCode?: string | null
  /** Backward-compatible identity matching from entity fields. */
  entityCode?: string | null
  entitySlug?: string | null
  entityName?: string | null
  /**
   * Optional allow-list for allowed template codes. If provided and unknown,
   * the value falls back to legacy identity/default resolution.
   */
  allowedCodes?: Set<string>
}

const TEMPLATE_ALIASES: Record<Exclude<QuotationPdfTemplateKey, "default">, string[]> = {
  qar: ["qar", "qarmour", "qarmoursdnbhd"],
  cc: ["cc", "citruscloud", "citruscloudsdnbhd"],
}

export function normalizeQuotationPdfTemplateCode(
  value: string | null | undefined
): QuotationPdfTemplateCode | null {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
  return normalized.length > 0 ? normalized : null
}

export function isQuotationPdfTemplateCode(
  value: string | null | undefined
): boolean {
  return normalizeQuotationPdfTemplateCode(value) !== null
}

export function isBuiltinQuotationPdfTemplateCode(
  value: string | null | undefined
): value is QuotationPdfTemplateKey {
  const normalized = normalizeQuotationPdfTemplateCode(value)
  return (
    normalized !== null &&
    QUOTATION_PDF_TEMPLATE_KEYS.has(normalized as QuotationPdfTemplateKey)
  )
}

function normalizeTemplateIdentity(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isTemplateAllowed(
  value: string,
  allowedCodes?: Set<string>
): boolean {
  if (!allowedCodes || allowedCodes.size === 0) {
    return isBuiltinQuotationPdfTemplateCode(value)
  }
  return allowedCodes.has(value)
}

function resolveAliasTemplate(rawCode: string): QuotationPdfTemplateKey | null {
  for (const [template, aliases] of Object.entries(TEMPLATE_ALIASES) as Array<
    [Exclude<QuotationPdfTemplateKey, "default">, string[]]
  >) {
    if (aliases.includes(rawCode)) return template
  }
  return null
}

export function resolveQuotationPdfTemplate({
  rawTemplateCode,
  entityCode,
  entitySlug,
  entityName,
  allowedCodes,
}: ResolveQuotationPdfTemplateInput): string {
  const explicit = normalizeQuotationPdfTemplateCode(rawTemplateCode)
  if (explicit) {
    if (isTemplateAllowed(explicit, allowedCodes)) return explicit

    const resolvedAlias = resolveAliasTemplate(explicit)
    if (resolvedAlias && isTemplateAllowed(resolvedAlias, allowedCodes)) {
      return resolvedAlias
    }
  }

  const identities = [entityCode, entitySlug, entityName]
    .map(normalizeTemplateIdentity)
    .filter(Boolean)

  for (const [template, aliases] of Object.entries(TEMPLATE_ALIASES) as Array<
    [Exclude<QuotationPdfTemplateKey, "default">, string[]]
  >) {
    if (identities.some((identity) => aliases.includes(identity))) {
      if (isTemplateAllowed(template, allowedCodes)) return template
    }
  }

  const defaultTemplate = "default"
  if (isTemplateAllowed(defaultTemplate, allowedCodes)) return defaultTemplate
  if (allowedCodes && allowedCodes.size > 0) {
    // No explicit/default match. Pick any first active template as long as one exists.
    const [first] = [...allowedCodes]
    if (first) return first
  }
  return defaultTemplate
}
