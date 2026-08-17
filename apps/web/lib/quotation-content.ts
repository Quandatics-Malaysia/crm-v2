export type QuotationContentDefaults = {
  notes: string | null
  delivery: string | null
  paymentTerm: string | null
}

export type QuotationContentInput = Partial<QuotationContentDefaults>

export const QUOTATION_CONTENT_LIMITS = {
  notes: 2000,
  delivery: 500,
  paymentTerm: 120,
} as const

export function snapshotQuotationLineDescription(input: {
  description?: string | null
  productDescription?: string | null
  productName: string
}): string {
  return input.description?.trim() || input.productDescription?.trim() || input.productName
}

/** Resolve new-quotation content while treating null as an intentional blank. */
export function resolveQuotationContent(
  input: QuotationContentInput,
  defaults: QuotationContentDefaults
): QuotationContentDefaults {
  const content = {
    notes: input.notes === undefined ? defaults.notes : input.notes?.trim() || null,
    delivery:
      input.delivery === undefined ? defaults.delivery : input.delivery?.trim() || null,
    paymentTerm:
        input.paymentTerm === undefined
          ? defaults.paymentTerm
          : input.paymentTerm?.trim() || null,
  }
  assertQuotationContentLengths(content)
  return content
}

export function assertQuotationContentLengths(
  content: QuotationContentDefaults
): void {
  const fields = [
    ["Notes", content.notes, QUOTATION_CONTENT_LIMITS.notes],
    ["Delivery", content.delivery, QUOTATION_CONTENT_LIMITS.delivery],
    ["Payment term", content.paymentTerm, QUOTATION_CONTENT_LIMITS.paymentTerm],
  ] as const
  for (const [label, value, limit] of fields) {
    if (value != null && value.length > limit) {
      throw new Error(`${label} must be ${limit} characters or fewer`)
    }
  }
}

export function attentionContactChanged(
  existingContactId: string | null,
  requestedContactId: string | null
): boolean {
  return existingContactId !== requestedContactId
}

export function quotationContentAuditSnapshot(input: {
  attentionContactId: string | null
  notes: string | null
  delivery: string | null
  paymentTerm: string | null
}): {
  attentionContactId: string | null
  notes: string | null
  delivery: string | null
  paymentTerm: string | null
} {
  return {
    attentionContactId: input.attentionContactId,
    notes: input.notes,
    delivery: input.delivery,
    paymentTerm: input.paymentTerm,
  }
}

export function assertAttentionContactBelongsToAccount(
  contactAccountId: string | null,
  recipientAccountId: string | null
): void {
  if (contactAccountId !== recipientAccountId) {
    throw new Error("Attention contact must belong to recipient account")
  }
}
