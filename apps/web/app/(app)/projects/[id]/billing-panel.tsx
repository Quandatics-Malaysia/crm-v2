"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { StatusBadge } from "@/components/status-badge"
import { formatMoney, formatDate } from "@/lib/format"
import { FINANCE_KINDS, type FinanceDocKind } from "@/lib/finance-kinds"
import type { ProjectBillingSummary } from "@/app/(app)/billing/actions"

/**
 * Project → Billing tab: read-only finance document rollup and margin. Payment
 * milestones are intentionally not an invoice entry point.
 */
export function BillingPanel({
  summary,
}: {
  summary: ProjectBillingSummary
}) {
  const value = Number(summary.projectValue ?? 0)
  const invoiced = Number(summary.invoiced)
  const paid = Number(summary.paid)
  const pctInvoiced = value > 0 ? Math.min(100, (invoiced / value) * 100) : 0
  const pctPaid = value > 0 ? Math.min(100, (paid / value) * 100) : 0

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Billing progress</CardTitle>
          <CardDescription>
            {formatMoney(summary.invoiced, summary.currency)} invoiced ·{" "}
            {formatMoney(summary.paid, summary.currency)} paid
            {summary.projectValue
              ? ` · of ${formatMoney(summary.projectValue, summary.currency)} project value`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {value > 0 ? (
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 bg-sky-400/70"
                style={{ width: `${pctInvoiced}%` }}
                title={`Invoiced ${pctInvoiced.toFixed(0)}%`}
              />
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500"
                style={{ width: `${pctPaid}%` }}
                title={`Paid ${pctPaid.toFixed(0)}%`}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            {Number(summary.creditNotes) > 0 ? (
              <span>
                Credit notes −{formatMoney(summary.creditNotes, summary.currency)}
              </span>
            ) : null}
            <span>
              Purchase cost {formatMoney(summary.purchaseCost, summary.currency)}
            </span>
            <span className="font-medium text-foreground">
              Billed margin {formatMoney(summary.margin, summary.currency)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {summary.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No billing documents yet.
            </p>
          ) : (
            summary.docs.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="inline-flex items-center gap-2">
                  <Link href={`/billing/${d.id}`} className="font-mono link">
                    {d.number}
                  </Link>
                  <Badge variant="outline">
                    {FINANCE_KINDS[d.kind as FinanceDocKind].label}
                  </Badge>
                  {d.docDate ? (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(d.docDate)}
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="tabular-nums">
                    {formatMoney(d.amount, d.currency)}
                  </span>
                  <StatusBadge status={d.status} />
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
