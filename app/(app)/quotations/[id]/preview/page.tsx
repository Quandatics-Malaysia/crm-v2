import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatMoney, formatDate } from "@/lib/format"
import { getQuotationDocument } from "../../actions"
import { PrintButton } from "./print-button"

type DocAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
} | null

function addressLines(addr: DocAddress): string[] {
  if (!addr) return []
  const cityLine = [addr.city, addr.state, addr.postcode]
    .filter(Boolean)
    .join(", ")
  return [addr.line1, addr.line2, cityLine, addr.country].filter(
    (v): v is string => !!v && v.trim().length > 0
  )
}

export default async function QuotationPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const doc = await getQuotationDocument(id)
  if (!doc) notFound()

  const { quotation: q, lines, account, contact, entityName } = doc
  const currency = q.currency
  const subtotal = Number(q.subtotal)
  const discountTotal = Number(q.discountTotal)
  const taxTotal = Number(q.taxTotal)
  const total = Number(q.total)
  const lineAddr = addressLines(account?.address ?? null)

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
        <PrintButton />
      </div>

      {/* The printable document — A4 page (210×297mm) floating on the desk. */}
      <div
        id="quote-doc"
        className="mx-auto min-h-[297mm] w-[210mm] max-w-full overflow-hidden rounded-lg bg-white text-sm text-zinc-900 shadow-lg ring-1 ring-zinc-200/60 print:min-h-0 print:w-full print:max-w-none print:rounded-none print:shadow-none print:ring-0"
      >
        {/* Brand accent bar */}
        <div className="h-2 w-full bg-red-600 print:h-1.5" />

        <div className="p-10 print:p-8">
          <header className="flex items-start justify-between gap-6 border-b border-zinc-200 pb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{entityName}</h1>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                Quotation
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

        {/* Bill to */}
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

        {/* Line items */}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-zinc-50 text-left text-xs text-zinc-500 print:bg-zinc-50">
              <th className="py-2 pr-2 pl-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 text-right font-medium">Qty</th>
              <th className="py-2 pr-2 font-medium">UOM</th>
              <th className="py-2 pr-2 text-right font-medium">Unit price</th>
              <th className="py-2 pr-2 text-right font-medium">Discount</th>
              <th className="py-2 pr-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2 pr-2 pl-2 text-zinc-500">{i + 1}</td>
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {Number(l.quantity)}
                </td>
                <td className="py-2 pr-2">{l.uom ?? "—"}</td>
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

          <p className="mt-10 border-t border-zinc-200 pt-4 text-center text-[11px] text-zinc-400">
            This quotation was generated by {entityName}. Prices are in{" "}
            {currency} and valid until the date shown above.
          </p>
        </div>
      </div>
    </div>
  )
}
