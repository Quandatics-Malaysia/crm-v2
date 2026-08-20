"use client"

import * as React from "react"
import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DetailAside,
  DetailCardHeader,
  FieldRow,
  FieldSection,
  RelatedCard,
  useSaveField,
} from "@/components/detail-page"
import { InlineValue } from "@/components/inline-value"
import { StatusBadge } from "@/components/status-badge"
import { StagePathView, type PathStep } from "@/components/stage-path-view"
import { formatDate, formatMoney } from "@/lib/format"
import { paymentMilestoneStatus } from "@/db/schema"
import {
  updateFunnelMilestone,
  type FunnelMilestoneUpdateInput,
  type PaymentMilestoneDetail,
} from "./actions"

const STATUS_ORDER = paymentMilestoneStatus.enumValues
const STATUS_LABELS: Record<(typeof STATUS_ORDER)[number], string> = {
  won: "Won",
  invoiced: "Invoiced",
}

/** Planning-only milestone detail. Finance documents are intentionally absent. */
export function PaymentMilestoneDetailBody({
  milestone,
  canManage,
}: {
  milestone: PaymentMilestoneDetail
  canManage: boolean
}) {
  const saveField = useSaveField((patch: FunnelMilestoneUpdateInput) =>
    updateFunnelMilestone(milestone.id, patch)
  )
  const canEditAmount = canManage && milestone.status === "won"
  const currentIndex = STATUS_ORDER.indexOf(milestone.status)
  const steps: PathStep[] = STATUS_ORDER.map((status, index) => ({
    id: status,
    label: STATUS_LABELS[status],
    state:
      index < currentIndex
        ? "done"
        : index === currentIndex
          ? "current"
          : "upcoming",
    tone: status === "won" ? "won" : "default",
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <DetailAside>
        <Card>
          <DetailCardHeader
            kind="milestone"
            eyebrow="Payment milestone"
            title={milestone.title}
          />
          <CardContent className="grid gap-3">
            {canEditAmount ? (
              <InlineValue
                value={milestone.amount}
                display={
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatMoney(milestone.amount)}
                  </span>
                }
                formatDraft={(value) => (
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatMoney(value || "0")}
                  </span>
                )}
                type="number"
                title="Click to edit amount"
                onSave={(next) => saveField({ amount: next || null })}
              />
            ) : (
              <div
                className="text-2xl font-semibold tabular-nums"
                title={
                  canManage && milestone.status === "invoiced"
                    ? "Amount is locked once the milestone is invoiced."
                    : undefined
                }
              >
                {formatMoney(milestone.amount)}
              </div>
            )}
            <div className="grid gap-1">
              <StatusBadge status={milestone.status} />
              <p className="text-xs text-muted-foreground">
                Updated from the quotation and invoice workflow.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Highlights</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <FieldRow label="Quote number">
              {milestone.quotationId && milestone.quoteNumber ? (
                <Link href={`/quotations/${milestone.quotationId}`} className="link">
                  {milestone.quoteNumber}
                </Link>
              ) : (
                "—"
              )}
            </FieldRow>
            <FieldRow label="Amount">{formatMoney(milestone.amount)}</FieldRow>
            <FieldRow label="Status">
              <StatusBadge status={milestone.status} />
            </FieldRow>
          </CardContent>
        </Card>

        <RelatedCard
          items={[
            ...(milestone.funnelId
              ? [{ kind: "funnel" as const, label: "Funnel", href: `/funnel/${milestone.funnelId}` }]
              : []),
            ...(milestone.projectId
              ? [{ kind: "project" as const, label: "Project", href: `/projects/${milestone.projectId}` }]
              : []),
            ...(milestone.quotationId
              ? [{ kind: "quotation" as const, label: "Quotation", href: `/quotations/${milestone.quotationId}` }]
              : []),
          ]}
        />
      </DetailAside>

      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Milestone status</CardTitle>
          </CardHeader>
          <CardContent>
            <StagePathView steps={steps} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planning details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <FieldSection title="Payment Milestone">
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <FieldRow label="Name">
                    {canManage ? (
                      <InlineValue
                        value={milestone.title}
                        display={milestone.title}
                        title="Click to edit name"
                        onSave={(next) => {
                          if (!next.trim()) return
                          return saveField({ title: next })
                        }}
                      />
                    ) : (
                      milestone.title
                    )}
                  </FieldRow>
                  <FieldRow label="Funnel">
                    {milestone.funnelId && milestone.funnelName ? (
                      <Link href={`/funnel/${milestone.funnelId}`} className="link">
                        {milestone.funnelName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </FieldRow>
                  <FieldRow label="Product category">
                    {milestone.productCategory ?? "—"}
                  </FieldRow>
                  <FieldRow label="Product subcategory">
                    {milestone.productSubcategory ?? "—"}
                  </FieldRow>
                  <FieldRow label="SO number">
                    {canManage ? (
                      <InlineValue
                        value={milestone.soNumber ?? ""}
                        display={milestone.soNumber || "—"}
                        title="Click to edit SO number"
                        onSave={(next) => saveField({ soNumber: next || null })}
                      />
                    ) : (
                      milestone.soNumber ?? "—"
                    )}
                  </FieldRow>
            <FieldRow label="Quote">
                    {milestone.quotationId && milestone.quoteNumber ? (
                      <Link href={`/quotations/${milestone.quotationId}`} className="link">
                        {milestone.quoteNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
            </FieldRow>
                  <FieldRow label="Quotation status">
                    {milestone.quoteStatus ? (
                      <StatusBadge status={milestone.quoteStatus} />
                    ) : (
                      "—"
                    )}
                  </FieldRow>
                  <FieldRow label="Quotation total">
                    {milestone.quoteTotal
                      ? formatMoney(milestone.quoteTotal, milestone.quoteCurrency ?? undefined)
                      : "—"}
                  </FieldRow>
                  <FieldRow label="Due date">
                    {canManage ? (
                      <InlineValue
                        value={milestone.dueDate ?? ""}
                        display={formatDate(milestone.dueDate)}
                        formatDraft={(value) => (value ? formatDate(value) : "—")}
                        type="date"
                        title="Click to edit due date"
                        onSave={(next) => saveField({ dueDate: next || null })}
                      />
                    ) : (
                      formatDate(milestone.dueDate)
                    )}
                  </FieldRow>
                  <FieldRow label="Remarks" className="sm:col-span-2">
                    {canManage ? (
                      <InlineValue
                        value={milestone.description ?? ""}
                        multiline
                        display={
                          <span className="whitespace-pre-wrap">
                            {milestone.description || "Add remarks"}
                          </span>
                        }
                        title="Click to edit remarks"
                        onSave={(next) => saveField({ description: next || null })}
                      />
                    ) : (
                      <span className="whitespace-pre-wrap">
                        {milestone.description || "—"}
                      </span>
                    )}
                  </FieldRow>
                </div>
              </FieldSection>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
