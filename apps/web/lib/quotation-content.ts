export type QuotationContentDefaults = {
  notes: string | null
  delivery: string | null
  paymentTerm: string | null
}

export type QuotationContentInput = Partial<QuotationContentDefaults>

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
  return {
    notes: input.notes === undefined ? defaults.notes : input.notes?.trim() || null,
    delivery:
      input.delivery === undefined ? defaults.delivery : input.delivery?.trim() || null,
    paymentTerm:
      input.paymentTerm === undefined
        ? defaults.paymentTerm
        : input.paymentTerm?.trim() || null,
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
