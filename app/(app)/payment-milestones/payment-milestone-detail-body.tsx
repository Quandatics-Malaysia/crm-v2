"use client"

import * as React from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ObjectTile } from "@/components/object-tile"
import { StatusBadge } from "@/components/status-badge"
import { StagePathView, type PathStep } from "@/components/stage-path-view"
import { formatDate, formatMoney } from "@/lib/format"
import { paymentMilestoneStatus } from "@/db/schema"
import type { PaymentMilestoneDetail } from "./actions"

// The invoice lifecycle order — mirrors the payment_milestone_status enum.
const STATUS_ORDER = paymentMilestoneStatus.enumValues
const STATUS_LABELS: Record<(typeof STATUS_ORDER)[number], string> = {
  pending: "Pending",
  invoiced: "Invoiced",
  paid: "Paid",
}

/**
 * Salesperson-friendly payment milestone detail: a left column with the money
 * highlights + invoice status path, and a right column with the milestone and
 * invoice detail sections.
 */
export function PaymentMilestoneDetailBody({
  milestone,
}: {
  milestone: PaymentMilestoneDetail
}) {
  const currentIndex = STATUS_ORDER.indexOf(milestone.status)
  const steps: PathStep[] = STATUS_ORDER.map((s, i) => ({
    id: s,
    label: STATUS_LABELS[s],
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
    tone: s === "paid" ? "won" : "default",
  }))
  const paid = milestone.status === "paid"

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column — money highlights + invoice status path */}
      <div className="grid h-fit gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2.5 space-y-0">
            <ObjectTile kind="milestone" />
            <div className="grid">
              <span className="text-xs text-muted-foreground">
                Payment Milestone
              </span>
              <CardTitle className="text-base">Amount</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(milestone.amount)}
              </div>
              <div className="text-xs text-muted-foreground">
                <StatusBadge status={milestone.status} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Highlights</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Field label="Quote number">
              {milestone.quotationId && milestone.quoteNumber ? (
                <Link
                  href={`/quotations/${milestone.quotationId}`}
                  className="link"
                >
                  {milestone.quoteNumber}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Invoice number">
              {milestone.invoiceNumber ?? "—"}
            </Field>
            <Field label="Amount">{formatMoney(milestone.amount)}</Field>
            <Field label="Actual invoice date">
              {formatDate(milestone.invoiceDate)}
            </Field>
            <Field label="Payment received?">
              <StatusBadge
                status={paid ? "paid" : "pending"}
                label={paid ? "Yes" : "No"}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* Right column — invoice status path + detail sections */}
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice status</CardTitle>
          </CardHeader>
          <CardContent>
            <StagePathView steps={steps} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-6 pt-6">
            <section>
              <h3 className="mb-3 text-sm font-semibold">Payment Milestone</h3>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Field label="Name">{milestone.title}</Field>
                <Field label="Funnel">
                  {milestone.funnelId && milestone.funnelName ? (
                    <Link
                      href={`/funnel/${milestone.funnelId}`}
                      className="link"
                    >
                      {milestone.funnelName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="Product category">
                  {milestone.productCategory ?? "—"}
                </Field>
                <Field label="Product subcategory">
                  {milestone.productSubcategory ?? "—"}
                </Field>
                <Field label="SO number">{milestone.soNumber ?? "—"}</Field>
                <Field label="Quote">
                  {milestone.quotationId && milestone.quoteNumber ? (
                    <Link
                      href={`/quotations/${milestone.quotationId}`}
                      className="link"
                    >
                      {milestone.quoteNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Field>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">Invoice Details</h3>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Field label="Invoice number">
                  {milestone.invoiceNumber ?? "—"}
                </Field>
                <Field label="Invoice date">
                  {formatDate(milestone.invoiceDate)}
                </Field>
                <Field label="Expected invoice month">
                  {milestone.expectedInvoiceMonth ?? "—"}
                </Field>
                <Field label="Expected invoice year">
                  {milestone.expectedInvoiceYear ?? "—"}
                </Field>
                <Field label="Amount">{formatMoney(milestone.amount)}</Field>
                <Field label="Status">
                  <StatusBadge status={milestone.status} />
                </Field>
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
