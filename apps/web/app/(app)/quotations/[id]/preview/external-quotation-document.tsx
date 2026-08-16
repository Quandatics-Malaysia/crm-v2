import type { QuotationDocument } from "../../actions"
import type { QuotationTemplateSpec } from "@/lib/quotation-template-registry"
import { formatDate, formatMoney } from "@/lib/format"
import { renderQuotationTemplate } from "@/lib/quotation-template-renderer"

function taxLabel(doc: QuotationDocument): string {
  const rate = Number(doc.quotation.taxRateSnapshot)
  if (!Number.isFinite(rate) || rate <= 0) return "SST"
  return `SST @ ${new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: 3,
  }).format(rate)}%`
}

function templateContext(doc: QuotationDocument) {
  const currency = doc.quotation.currency
  const contactName = doc.contact?.name ?? "—"

  return {
    entityName: doc.entityName,
    entityRegistrationNo: doc.company.registrationNo ?? "",
    companyAddress: doc.company.address ?? "",
    companyPhone: doc.company.phone ?? "",
    companyEmail: doc.company.email ?? "",
    companyWebsite: doc.company.website ?? "",
    logoUrl: "/api/tenant-logo",
    quoteNumber: doc.quotation.quoteNumber,
    quoteDate: formatDate(doc.quotation.quoteDate ?? doc.quotation.createdAt),
    validUntil: formatDate(doc.quotation.validUntil),
    currency,
    customerName: doc.account?.name ?? "—",
    customerCode: doc.account?.code ?? "",
    customerPhone: doc.account?.phone ?? "",
    customerContact: contactName,
    customerEmail: doc.contact?.email ?? "",
    projectName: doc.projectName,
    delivery: "—",
    paymentTerm: "—",
    quoteValidity: doc.quotation.validUntil ? formatDate(doc.quotation.validUntil) : "—",
    price: currency,
    subtotal: formatMoney(doc.quotation.subtotal, currency),
    discountTotal: formatMoney(doc.quotation.discountTotal, currency),
    taxTotal: formatMoney(doc.quotation.taxTotal, currency),
    taxLabel: taxLabel(doc),
    total: formatMoney(doc.quotation.total, currency),
    notes: doc.quotation.notes ?? "",
    preparedBy: doc.preparedBy?.name ?? "",
    preparedByEmail: doc.preparedBy?.email ?? "",
    lines: doc.lines.map((line) => ({
      sku: line.sku ?? "",
      description: line.description,
      quantity: line.quantity,
      uom: line.uom ?? "",
      unitPrice: formatMoney(line.unitPrice, currency),
      lineSubtotal: formatMoney(line.lineSubtotal, currency),
      lineTotal: formatMoney(line.lineTotal, currency),
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
        id="external-quote-template"
        className="mx-auto min-h-[297mm] w-[210mm] max-w-full overflow-hidden bg-white shadow-lg print:min-h-[297mm] print:w-[210mm] print:shadow-none"
        data-template={template.code}
      >
        <style dangerouslySetInnerHTML={{ __html: rendered.css }} />
        <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    </div>
  )
}
