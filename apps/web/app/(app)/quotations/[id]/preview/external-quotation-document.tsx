import type { QuotationDocument } from "../../actions"
import type { QuotationTemplateSpec } from "@/lib/quotation-template-registry"
import { renderQuotationTemplate } from "@/lib/quotation-template-renderer"

function formatQuotationDate(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function formatQuotationMoney(value: string | number | null | undefined): string {
  const amount = typeof value === "string" ? Number(value) : value ?? 0
  return new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatMalaysianPhone(value: string | null | undefined): string {
  const raw = value?.trim() ?? ""
  if (!raw) return ""
  const digits = raw.replace(/[^0-9]/g, "")
  if (!digits) return raw

  const international = digits.startsWith("60") ? digits : `60${digits.replace(/^0/, "")}`
  const national = international.slice(2)
  if (national.startsWith("3") && national.length === 9) {
    return `+603-${national.slice(1, 5)} ${national.slice(5)}`
  }
  if (national.startsWith("1") && national.length >= 9) {
    return `+60${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`
  }
  return `+${international}`
}

function customerAddress(doc: QuotationDocument): string {
  const address = doc.account?.address
  if (!address) return ""
  return [
    address.line1,
    address.line2,
    [address.postcode, address.city, address.state].filter(Boolean).join(" "),
    address.country,
  ].filter((part): part is string => Boolean(part?.trim())).join(", ")
}

function taxLabel(doc: QuotationDocument): string {
  const rate = Number(doc.quotation.taxRateSnapshot)
  const subtotal = Number(doc.quotation.subtotal)
  const taxTotal = Number(doc.quotation.taxTotal)
  const derivedRate = subtotal > 0 && taxTotal > 0 ? (taxTotal / subtotal) * 100 : 0
  const displayRate = Number.isFinite(rate) && rate > 0 ? rate : derivedRate
  if (!Number.isFinite(displayRate) || displayRate <= 0) return "SST"
  return `SST @ ${new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: 3,
  }).format(displayRate)}%`
}

function templateContext(doc: QuotationDocument) {
  const currency = doc.quotation.currency
  const contactName = doc.contact?.name ?? "—"

  return {
    entityName: doc.entityName,
    entityRegistrationNo: doc.company.registrationNo ?? "",
    companyAddress: doc.company.address ?? "",
    companyPhone: formatMalaysianPhone(doc.company.phone),
    companyEmail: doc.company.email ?? "",
    companyWebsite: doc.company.website ?? "",
    logoUrl: "/api/tenant-logo",
    quoteNumber: doc.quotation.quoteNumber,
    quoteDate: formatQuotationDate(doc.quotation.quoteDate ?? doc.quotation.createdAt),
    validUntil: formatQuotationDate(doc.quotation.validUntil),
    currency,
    customerName: doc.account?.name ?? "—",
    customerCode: doc.account?.code ?? "",
    customerAddress: customerAddress(doc),
    customerPhone: formatMalaysianPhone(doc.account?.phone),
    customerContact: contactName,
    customerEmail: doc.contact?.email ?? "",
    projectName: doc.projectName,
    delivery: doc.quotation.delivery ?? "",
    paymentTerm: doc.quotation.paymentTerm ?? "",
    quoteValidity: doc.quotation.validUntil ? formatQuotationDate(doc.quotation.validUntil) : "—",
    price: currency,
    subtotal: formatQuotationMoney(doc.quotation.subtotal),
    discountTotal: formatQuotationMoney(doc.quotation.discountTotal),
    taxTotal: formatQuotationMoney(doc.quotation.taxTotal),
    taxLabel: taxLabel(doc),
    total: formatQuotationMoney(doc.quotation.total),
    notes: doc.quotation.notes ?? "",
    preparedBy: doc.preparedBy?.name ?? "",
    preparedByEmail: doc.preparedBy?.email ?? "",
    lines: doc.lines.map((line) => ({
      sku: line.sku ?? "",
      description: line.description,
      quantity: line.quantity,
      uom: line.uom ?? "",
      unitPrice: formatQuotationMoney(line.unitPrice),
      lineSubtotal: formatQuotationMoney(line.lineSubtotal),
      lineTotal: formatQuotationMoney(line.lineTotal),
    })),
  }
}

export function ExternalQuotationDocument({
  doc,
  template,
}: {
  doc: QuotationDocument
  template: QuotationTemplateSpec
}) {
  if (!template.htmlTemplate) return null

  const rendered = renderQuotationTemplate({
    htmlTemplate: template.htmlTemplate,
    cssTemplate: template.cssTemplate,
    context: templateContext(doc),
  })

  return (
    <div className="bg-muted/30 py-6 print:bg-white print:py-0">
      <div
        id="quote-doc"
        className="mx-auto min-h-[297mm] w-[210mm] max-w-full overflow-hidden bg-white shadow-lg print:min-h-[297mm] print:w-[210mm] print:shadow-none"
        data-template={template.code}
      >
        <style dangerouslySetInnerHTML={{ __html: rendered.css }} />
        <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    </div>
  )
}
