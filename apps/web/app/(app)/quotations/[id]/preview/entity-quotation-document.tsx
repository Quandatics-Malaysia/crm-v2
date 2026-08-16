import type { QuotationDocument } from "../../actions"
import type { QuotationPdfTemplateKey } from "@/lib/quotation-pdf-template"

type EntityTemplateKey = Exclude<QuotationPdfTemplateKey, "default">

function addressLines(address: QuotationDocument["account"] extends infer A
  ? A extends { address: infer Address }
    ? Address
    : never
  : never): string[] {
  if (!address) return []
  const locality = [address.postcode, address.city, address.state]
    .filter(Boolean)
    .join(" ")
  return [address.line1, address.line2, locality, address.country].filter(
    (line): line is string => Boolean(line?.trim())
  )
}

function plainMoney(value: string | number, currency: string): string {
  return new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value)) + (currency === "MYR" ? "" : ` ${currency}`)
}

function documentDate(value: Date | string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function quoteValidityDays(doc: QuotationDocument): string {
  if (!doc.quotation.validUntil) return "—"
  const start = new Date(doc.quotation.quoteDate ?? doc.quotation.createdAt)
  const end = new Date(doc.quotation.validUntil)
  const days = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000))
  return `${days} days`
}

function taxLabel(doc: QuotationDocument): string {
  const rate = Number(doc.quotation.taxRateSnapshot)
  if (!Number.isFinite(rate) || rate <= 0) return "SST"
  return `SST @ ${new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: 3,
  }).format(rate)}%`
}

function CompanyHeader({ doc }: { doc: QuotationDocument }) {
  return (
    <header className="grid grid-cols-[29%_1fr] items-start gap-6 pb-3">
      <div className="h-[24mm]">
        {doc.company.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/api/tenant-logo"
            alt={doc.entityName}
            className="h-[22mm] max-w-[55mm] object-contain object-left"
          />
        ) : null}
      </div>
      <div className="text-[10px] leading-[1.35]">
        <div className="text-[13px] font-bold uppercase">
          {doc.entityName}
          {doc.company.registrationNo ? ` ${doc.company.registrationNo}` : ""}
        </div>
        {doc.company.address ? <div className="whitespace-pre-line uppercase">{doc.company.address}</div> : null}
        <div>
          {doc.company.phone ? `Tel: ${doc.company.phone}` : ""}
          {doc.company.email ? `   Email: ${doc.company.email}` : ""}
        </div>
      </div>
    </header>
  )
}

function CustomerAndMeta({ doc }: { doc: QuotationDocument }) {
  const addresses = addressLines(doc.account?.address ?? null)
  const rows = [
    ["Ref. No", doc.quotation.quoteNumber],
    ["Date", documentDate(doc.quotation.quoteDate ?? doc.quotation.createdAt)],
    ["Currency", doc.quotation.currency],
    ["Delivery", "—"],
    ["Payment Term", "—"],
    ["Quote Validity", quoteValidityDays(doc)],
    ["Price", doc.quotation.currency],
  ]

  return (
    <section className="grid grid-cols-[68%_32%] border-b border-black text-[10px]">
      <div className="relative min-h-[42mm] border-r border-black px-9 py-2">
        <div className="absolute left-1 top-2">To:</div>
        <div className="font-bold uppercase">{doc.account?.name ?? "—"}</div>
        {addresses.map((line) => <div key={line}>{line}</div>)}
        <dl className="absolute bottom-2 left-1 grid grid-cols-[30mm_1fr] gap-y-1">
          <dt>Attn:</dt><dd>{doc.contact?.name ?? "—"}</dd>
          <dt>Tel:</dt><dd>{doc.contact?.phone ?? "—"}</dd>
          <dt>Email:</dt><dd>{doc.contact?.email ?? "—"}</dd>
          <dt>Project:</dt><dd>{doc.projectName || "—"}</dd>
        </dl>
      </div>
      <dl className="py-1">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[38mm_4mm_1fr] px-2 py-0.5">
            <dt>{label}</dt><span>:</span><dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function QarLines({ doc }: { doc: QuotationDocument }) {
  return (
    <table className="w-full table-fixed border-collapse text-[10px]">
      <colgroup><col className="w-[8%]"/><col className="w-[44%]"/><col className="w-[12%]"/><col className="w-[16%]"/><col className="w-[20%]"/></colgroup>
      <thead><tr className="h-9 border-b border-black">
        <th className="border-r border-black font-normal">No</th><th className="border-r border-black font-normal">Description</th>
        <th className="border-r border-black text-right font-normal">QTY</th><th className="border-r border-black text-right font-normal">Unit Price</th><th className="text-right font-normal">Total Price</th>
      </tr></thead>
      <tbody>
        {doc.lines.map((line, index) => <tr key={line.id} className="h-10 border-b border-black align-top">
          <td className="border-r border-black px-2 py-1 text-center">{index + 1}</td><td className="border-r border-black px-2 py-1 whitespace-pre-wrap">{line.description}</td>
          <td className="border-r border-black px-2 py-1 text-right">{Number(line.quantity)}</td><td className="border-r border-black px-2 py-1 text-right">{plainMoney(line.unitPrice, doc.quotation.currency)}</td>
          <td className="px-2 py-1 text-right">{plainMoney(line.lineTotal, doc.quotation.currency)}</td>
        </tr>)}
        {Array.from({ length: Math.max(0, 9 - doc.lines.length) }).map((_, index) => <tr key={`blank-${index}`} className="h-9 border-b border-black"><td className="border-r border-black"/><td className="border-r border-black"/><td className="border-r border-black"/><td className="border-r border-black"/><td/></tr>)}
      </tbody>
    </table>
  )
}

function CcLines({ doc }: { doc: QuotationDocument }) {
  return (
    <table className="w-full table-fixed border-collapse text-[9px]">
      <colgroup><col className="w-[8%]"/><col className="w-[8%]"/><col className="w-[36%]"/><col className="w-[8%]"/><col className="w-[8%]"/><col className="w-[12%]"/><col className="w-[10%]"/><col className="w-[10%]"/></colgroup>
      <thead><tr className="h-8 border-b border-black">
        {['Item','SKU','Description','QTY','UOM',`Unit Price\n${doc.quotation.currency}`,`Subtotal\n${doc.quotation.currency}`,`Total Price\n${doc.quotation.currency}`].map((heading) => <th key={heading} className="px-1 text-right font-normal whitespace-pre-line first:text-left nth-[2]:text-left nth-[3]:text-left">{heading}</th>)}
      </tr></thead>
      <tbody>{doc.lines.map((line, index) => <tr key={line.id} className="h-16 align-top">
        <td className="px-2 py-1">{index + 1}</td><td className="px-1 py-1">{line.sku ?? ""}</td><td className="px-1 py-1 whitespace-pre-wrap">{line.description}</td>
        <td className="px-1 py-1 text-right">{Number(line.quantity)}</td><td className="px-1 py-1 text-right">{line.uom ?? ""}</td><td className="px-1 py-1 text-right">{plainMoney(line.unitPrice, doc.quotation.currency)}</td>
        <td className="px-1 py-1 text-right">{plainMoney(line.lineSubtotal, doc.quotation.currency)}</td><td className="px-1 py-1 text-right">{plainMoney(line.lineTotal, doc.quotation.currency)}</td>
      </tr>)}</tbody>
    </table>
  )
}

function Totals({ doc, template }: { doc: QuotationDocument; template: EntityTemplateKey }) {
  const currency = template === "qar" && doc.quotation.currency === "MYR" ? "RM" : doc.quotation.currency
  const labels = template === "qar"
    ? [[`Total (${currency})`, doc.quotation.subtotal], [`SST (${currency})`, doc.quotation.taxTotal], [`Total with SST (${currency})`, doc.quotation.total]]
    : [["Total (excl. of SST)", doc.quotation.subtotal], [taxLabel(doc), doc.quotation.taxTotal], ["Total (Inclusive of SST)", doc.quotation.total]]
  return <div className="ml-auto w-[42%] border-t border-black text-[10px]">{labels.map(([label, value]) => <div key={String(label)} className="grid h-9 grid-cols-[1fr_32mm] items-center border-b border-black"><div className="px-2 text-right">{label}</div><div className="px-2 text-right">{plainMoney(value, doc.quotation.currency)}</div></div>)}</div>
}

export function EntityQuotationDocument({ doc, template }: { doc: QuotationDocument; template: EntityTemplateKey }) {
  return (
    <div id="quote-doc" data-template={template} className="relative mx-auto min-h-[297mm] w-[210mm] max-w-full overflow-hidden bg-white px-[10mm] py-[10mm] font-sans text-black shadow-lg print:min-h-[297mm] print:w-[210mm] print:shadow-none">
      <CompanyHeader doc={doc}/>
      <h1 className="border-y border-black py-1 text-center text-[16px] font-bold">QUOTATION</h1>
      <CustomerAndMeta doc={doc}/>
      {template === "qar" ? <QarLines doc={doc}/> : <CcLines doc={doc}/>}
      <div className="flex min-h-[29mm] border-b border-black">
        <div className="flex-1 px-8 py-4 text-[9px] whitespace-pre-wrap">{doc.quotation.notes ? `Note:\n${doc.quotation.notes}` : ""}</div>
        <Totals doc={doc} template={template}/>
      </div>
      <div className="pt-2 text-[9px] font-bold">**Please Quote Our Reference Number When Placing An Order**</div>
      {template === "cc" && doc.preparedBy ? <div className="ml-auto -mt-3 w-[26%] text-[9px]"><div>Prepared by,</div><div className="font-bold">{doc.preparedBy.name}</div><div>{doc.preparedBy.email}</div></div> : null}
      <div className="pt-8 text-[8px] italic">This Quotation is computer generated and no signature is required.</div>
      {template === "cc" ? <footer className="absolute inset-x-[10mm] bottom-[8mm] flex justify-between text-[8px]"><span>{doc.entityName} {doc.company.website ? `w: ${doc.company.website}` : ""} {doc.company.email ? `e: ${doc.company.email}` : ""} {doc.company.phone ? `p: ${doc.company.phone}` : ""}</span><span>1</span></footer> : null}
    </div>
  )
}
