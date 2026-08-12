export type QuotationPdfTemplateKey = "default" | "qar" | "cc"

type ResolveQuotationPdfTemplateInput = {
  entityCode?: string | null
  entitySlug?: string | null
  entityName?: string | null
  /** Kept only for compatibility with older callers. Entity identity wins. */
  legacyKey?: string | null
}

const TEMPLATE_ALIASES: Record<Exclude<QuotationPdfTemplateKey, "default">, string[]> = {
  qar: ["qar", "qarmour", "qarmoursdnbhd"],
  cc: ["cc", "citruscloud", "citruscloudsdnbhd"],
}

function normalizeTemplateIdentity(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function resolveQuotationPdfTemplate({
  entityCode,
  entitySlug,
  entityName,
}: ResolveQuotationPdfTemplateInput): QuotationPdfTemplateKey {
  const identities = [entityCode, entitySlug, entityName]
    .map(normalizeTemplateIdentity)
    .filter(Boolean)

  for (const [template, aliases] of Object.entries(TEMPLATE_ALIASES) as Array<
    [Exclude<QuotationPdfTemplateKey, "default">, string[]]
  >) {
    if (identities.some((identity) => aliases.includes(identity))) return template
  }

  return "default"
}
