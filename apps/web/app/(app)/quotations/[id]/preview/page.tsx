import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatMoney, formatDate } from "@/lib/format"
import { getQuotationDocument } from "../../actions"
import { PrintButton } from "./print-button"
import { EntityQuotationDocument } from "./entity-quotation-document"
import { ExternalQuotationDocument } from "./external-quotation-document"
import { resolveQuotationPdfTemplate } from "@/lib/quotation-pdf-template"

type DocAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
} | null

type QuotationPdfTemplateSpec = {
  key: string
  label: string
  accentClass: string
  metaLabel: string
}

const DEFAULT_QUOTATION_PDF_TEMPLATE: QuotationPdfTemplateSpec = {
  key: "default",
  label: "Quotation",
  accentClass: "bg-red-600",
  metaLabel: "Quotation",
}

function addressLines(addr: DocAddress): string[] {
  if (!addr) return []
  const cityLine = [addr.city, addr.state, addr.postcode]
    .filter(Boolean)
    .join(", ")
  return [addr.line1, addr.line2, cityLine, addr.country].filter(
    (v): v is string => !!v && v.trim().length > 0
  )
}

function resolveQuotationPdfTemplateSpec(
  rawTemplateKey: string | null
): QuotationPdfTemplateSpec {
  const key = (rawTemplateKey ?? "").trim().toLowerCase()
  if (!key) return DEFAULT_QUOTATION_PDF_TEMPLATE
  if (key === "default") return DEFAULT_QUOTATION_PDF_TEMPLATE
  return {
    key,
    label: `Quotation (${key})`,
    accentClass: "bg-slate-700",
    metaLabel: "Quotation model",
  }
}

function isDefaultPdfTemplate(template: QuotationPdfTemplateSpec): boolean {
  return template.key === DEFAULT_QUOTATION_PDF_TEMPLATE.key
}

export default async function QuotationPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const doc = await getQuotationDocument(id)
  if (!doc) notFound()

  const {
    quotation: q,
    lines,
    account,
    contact,
    entityName,
    company,
    pdfTemplateKey,
    accountQuotationTemplateCode,
    resolvedTemplateCode,
    quotationTemplate,
  } = doc
  const currency = q.currency
  const subtotal = Number(q.subtotal)
  const discountTotal = Number(q.discountTotal)
  const taxTotal = Number(q.taxTotal)
  const total = Number(q.total)
  const entityTemplate = resolveQuotationPdfTemplate({
    accountTemplateCode: accountQuotationTemplateCode,
    rawTemplateCode: resolvedTemplateCode,
    entityCode: doc.entityCode,
    entitySlug: doc.entitySlug,
    entityName,
    legacyKey: pdfTemplateKey,
  })
  const template = resolveQuotationPdfTemplateSpec(pdfTemplateKey)
  const lineAddr = addressLines(account?.address ?? null)
  const isDefaultTemplate = isDefaultPdfTemplate(template)
  const attentionName =
    contact?.name ?? account?.name ?? "—"

  if (quotationTemplate?.renderMode === "html" && quotationTemplate.htmlTemplate) {
    return (
      <div className="bg-muted/30 py-6 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/quotations/${q.id}`} />}>
            <ArrowLeftIcon className="size-4" /> Back to quotation
          </Button>
          <PrintButton quoteNumber={q.quoteNumber} />
        </div>
        <ExternalQuotationDocument doc={doc} template={quotationTemplate} />
      </div>
    )
  }

  if (entityTemplate !== "default") {
    return (
      <div className="bg-muted/30 py-6 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/quotations/${q.id}`} />}>
            <ArrowLeftIcon className="size-4" /> Back to quotation
          </Button>
          <PrintButton quoteNumber={q.quoteNumber} />
        </div>
        <EntityQuotationDocument doc={doc} template={entityTemplate} />
      </div>
    )
  }

  return (
    <div className="bg-muted/30 py-6 print:bg-white print:py-0">
      {/* Action bar — hidden when printing */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/quotations/${q.id}`} />}
        >
          <ArrowLeftIcon className="size-4" />
          Back to quotation
        </Button>
        <PrintButton quoteNumber={q.quoteNumber} />
      </div>

      {/* The printable document — A4 page (210×297mm) floating on the desk. */}
      <div
        id="quote-doc"
        className="mx-auto min-h-[297mm] w-[210mm] max-w-full overflow-hidden rounded-lg bg-white text-sm text-zinc-900 shadow-lg ring-1 ring-zinc-200/60 print:min-h-0 print:w-full print:max-w-none print:rounded-none print:shadow-none print:ring-0"
        data-template={template.key}
      >
        {/* Brand accent bar */}
        <div
          className={`h-2 w-full print:h-1.5 ${template.accentClass}`}
        />

        <div className="p-10 print:p-8">
          <header className="flex items-start justify-between gap-6 border-b border-zinc-200 pb-6">
            <div>
              {company.hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/api/tenant-logo"
                  alt={entityName}
                  className="mb-2 h-12 max-w-52 object-contain object-left"
                />
              ) : null}
              <h1 className="text-2xl font-bold tracking-tight">{entityName}</h1>
              {company.registrationNo ? (
                <p className="text-xs text-zinc-500">
                  Reg. no. {company.registrationNo}
                </p>
              ) : null}
              {company.address ? (
                <p className="mt-1 text-xs whitespace-pre-line text-zinc-600">
                  {company.address}
                </p>
              ) : null}
              {(company.phone || company.email || company.website) && (
                <p className="mt-1 text-xs text-zinc-600">
                  {[
                    company.phone ? `Tel: ${company.phone}` : null,
                    company.email,
                    company.website,
                  ]
                  .filter(Boolean)
                  .join(" · ")}
                </p>
              )}
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                {template.label}
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono text-lg font-semibold text-red-600">
                {q.quoteNumber}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                <dt className="text-zinc-400">Date</dt>
                <dd className="text-right">{formatDate(q.createdAt)}</dd>
                {q.validUntil ? (
                  <>
                    <dt className="text-zinc-400">Valid until</dt>
                    <dd className="text-right">{formatDate(q.validUntil)}</dd>
                  </>
                ) : null}
                <dt className="text-zinc-400">Status</dt>
                <dd className="text-right capitalize">{q.status}</dd>
              </dl>
            </div>
          </header>

          {isDefaultTemplate ? (
            <section className="grid grid-cols-2 gap-6 py-6">
              <div>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                  Bill to
                </h2>
                {account ? (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="font-medium">{account.name}</div>
                    {lineAddr.map((l, i) => (
                      <div key={i} className="text-zinc-600">
                        {l}
                      </div>
                    ))}
                    {account.phone ? (
                      <div className="text-zinc-600">Tel: {account.phone}</div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1.5 text-zinc-500">—</p>
                )}
              </div>
              <div>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                  Contact
                </h2>
                {contact ? (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="font-medium">{contact.name}</div>
                    {contact.email ? (
                      <div className="text-zinc-600">{contact.email}</div>
                    ) : null}
                    {contact.phone ? (
                      <div className="text-zinc-600">{contact.phone}</div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1.5 text-zinc-500">—</p>
                )}
              </div>
            </section>
          ) : (
            <section className="avoid-break mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {template.metaLabel}
                  </div>
                  <div className="mt-1 font-medium text-slate-900">
                    {template.label}
                  </div>
                  {account?.code ? (
                    <div className="mt-1 text-slate-600">Account code: {account.code}</div>
                  ) : null}
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Attention
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{attentionName}</div>
                  {contact?.email ? (
                    <div className="mt-1 text-slate-600">{contact.email}</div>
                  ) : null}
                  {contact?.phone ? (
                    <div className="text-slate-600">{contact.phone}</div>
                  ) : null}
                </div>
              </div>
            </section>
          )}

        {/* Line items */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-zinc-50 text-left text-xs text-zinc-500 print:bg-zinc-50">
              <th className="py-2 pr-2 pl-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 font-medium">UOM</th>
              <th className="py-2 pr-2 text-right font-medium">Quantity</th>
              <th className="py-2 pr-2 text-right font-medium">Unit Price</th>
              <th className="py-2 pr-2 text-right font-medium">Item Discount</th>
              <th className="py-2 pr-2 text-right font-medium">Sub-total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2 pr-2 pl-2 text-zinc-500">{i + 1}</td>
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pr-2">{l.uom ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {Number(l.quantity)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatMoney(l.unitPrice, currency)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {Number(l.discountAmount) > 0
                    ? `−${formatMoney(l.discountAmount, currency)}`
                    : "—"}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatMoney(l.lineTotal, currency)}
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zinc-500">
                  No line items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Totals */}
        <div className="avoid-break mt-4 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-zinc-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(subtotal, currency)}</dd>
            </div>
            {discountTotal > 0 ? (
              <div className="flex justify-between text-zinc-600">
                <dt>Discount</dt>
                <dd className="tabular-nums">
                  −{formatMoney(discountTotal, currency)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between text-zinc-600">
              <dt>Tax{q.taxInclusive ? " (incl.)" : ""}</dt>
              <dd className="tabular-nums">{formatMoney(taxTotal, currency)}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between rounded-md bg-zinc-900 px-3 py-2 text-base font-semibold text-white">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(total, currency)}</dd>
            </div>
          </dl>
        </div>

        {q.notes ? (
          <section className="avoid-break mt-8 border-t border-zinc-200 pt-4">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Notes
            </h2>
            <p className="mt-1.5 whitespace-pre-wrap text-zinc-600">{q.notes}</p>
          </section>
        ) : null}

        {company.bankDetails ? (
          <section className="avoid-break mt-8 border-t border-zinc-200 pt-4">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Payment details
            </h2>
            <p className="mt-1.5 whitespace-pre-wrap text-zinc-600">
              {company.bankDetails}
            </p>
          </section>
        ) : null}

        {company.quoteFooter ? (
          <section className="avoid-break mt-8 border-t border-zinc-200 pt-4">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Terms
            </h2>
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-zinc-500">
              {company.quoteFooter}
            </p>
          </section>
        ) : null}

          <p className="mt-10 border-t border-zinc-200 pt-4 text-center text-[11px] text-zinc-400">
            This quotation was generated by {entityName}. Prices are in{" "}
            {currency} and valid until the date shown above.
          </p>
        </div>
      </div>
    </div>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const doc = await getQuotationDocument(id)
  return { title: doc?.quotation.quoteNumber ?? "Quotation" }
}
