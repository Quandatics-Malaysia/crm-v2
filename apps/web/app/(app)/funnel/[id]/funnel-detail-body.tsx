"use client"

import * as React from "react"
import Link from "next/link"
import { Plus, PencilIcon, ChevronRight } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { StatusBadge } from "@/components/status-badge"
import { STAGE_SOURCE_LABELS } from "@/lib/status-meta"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { TabsContent, TabsList } from "@/components/ui/tabs"
import {
  DataTable,
  SortableHeader,
  rightHeader,
  moneyCell,
  linkCell,
} from "@/components/data-table"
import {
  DetailAside,
  DetailCardHeader,
  TabsCard,
  RelatedCard,
  CountTab,
  useSaveField,
  FieldRow,
} from "@/components/detail-page"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { ChangeHistory } from "@/components/activity/change-history"
import { DocumentsSection } from "@/components/documents-section"
import { InlineValue } from "@/components/inline-value"
import { InlineCombobox } from "@/components/inline-combobox"
import { formatDate, formatMoney } from "@/lib/format"
import {
  isValidDateInput,
  isValidMoneyInput,
  isValidPercentInput,
  isValidYearInput,
} from "@/lib/input-validation"
import { partyShare, deriveOriginRecognizedAmount } from "@/lib/interco-share"
import type { Option, MemberOption } from "@/lib/lookups"
import {
  formatCustomFieldValue,
  groupCustomFields,
  type StageGate,
  type CustomFunnelField,
} from "@/lib/stage-gate"
import { StagePath } from "../stage-path"
import { StageBadge } from "../stage-badge"
import { CostsPanel } from "./costs-panel"
import { ContractPanel } from "./contract-panel"
import { IntercompanyDialog } from "../intercompany-dialog"
import {
  MilestonesPanel,
  type MilestoneItemBase,
} from "@/components/milestones-panel"
import { updateOpportunity } from "../actions"
import type { ApprovalRow } from "@/app/(app)/approvals/actions"
import type {
  OpportunityDetail,
  OpportunityProjectRow,
  OpportunityProductRow,
  OpportunityInput,
} from "../actions"
import type { DealCostRow } from "../cost-actions"
import type { ContractYearRow } from "../contract-actions"
import {
  createFunnelMilestone,
  updateFunnelMilestone,
  deleteFunnelMilestone,
  reorderFunnelMilestones,
  splitFunnelMilestones,
  type PaymentMilestoneRow,
} from "@/app/(app)/payment-milestones/actions"

/**
 * The Cost & margin tracker (external supplier / partner PO lines) is part of
 * the intercompany-billing economics, so it surfaces only when the finance
 * plugin is enabled (see `showCostMargin` in the component). Its margin is
 * computed against the deal's RECOGNIZED cut for intercompany deals — not the
 * whole quoted value — so external supplier costs reduce the true margin
 * instead of being folded into "our" recognized cut.
 */

/**
 * The multi-year Contract tracker is also hidden for now (same reasoning — not
 * mature yet). Panel/actions/schema are kept; flip to re-enable.
 */
const SHOW_CONTRACT = false

const INVOICE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((m) => ({ value: m, label: m }))

const PPVVC: {
  key: "pain" | "power" | "vision" | "value" | "control"
  label: string
}[] = [
  { key: "power", label: "1-P: Power Sponsor" },
  { key: "pain", label: "2-P: Pain" },
  { key: "vision", label: "3-V: Vision" },
  { key: "value", label: "4-V: Value" },
  { key: "control", label: "5-C: Control" },
]

// Status pills render via the app-wide <StatusBadge> tone map; the stage-change
// source labels come from the shared status-meta module.

/** One stage-approval request, read-only — from/to stage, status, requester
 *  and (once decided) approver + decision note. Mirrors the approvals inbox
 *  cards but with no action affordances (this is a history view). */
function ApprovalHistoryEntry({ row }: { row: ApprovalRow }) {
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">
            {row.fromStageName ?? "—"}
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{row.targetStageName}</span>
        </span>
        <StatusBadge status={row.status} />
      </div>
      {row.reason ? (
        <p className="text-sm text-muted-foreground">{row.reason}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Requested by{" "}
          <span className="text-foreground">
            {row.requesterName ?? "Unknown"}
          </span>{" "}
          on {formatDate(row.requestedAt)}
        </span>
        {row.decidedAt ? (
          <span>
            {row.status === "cancelled" ? "Cancelled" : "Decided"} by{" "}
            <span className="text-foreground">
              {row.approverName ?? "Unknown"}
            </span>{" "}
            on {formatDate(row.decidedAt)}
          </span>
        ) : null}
      </div>
      {row.decisionNote ? (
        <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
          Note: {row.decisionNote}
        </p>
      ) : null}
    </div>
  )
}

type StageLite = OpportunityDetail["funnelStagesList"][number]

export type FunnelDetailData = {
  funnelId: string
  currentStageId: string
  stages: StageLite[]
  interactive: boolean
  /** The Funnel's own name (Salesforce "Funnel Name") — distinct from `funnelName` below (the pipeline template). */
  name: string
  accountId: string
  accountName: string | null
  /** Every account, for the inline Account picker. */
  accountOptions: Option[]
  container: {
    id: string
    code: string
    name: string
    pain: string | null
    power: string | null
    vision: string | null
    value: string | null
    control: string | null
  } | null
  ownerMemberId: string
  ownerName: string | null
  /** Every tenant member, for the inline Owner picker. */
  members: MemberOption[]
  personId: string | null
  personName: string | null
  /** Every person (with account), for the inline Contact picker — filtered client-side to `accountId`. */
  persons: { id: string; name: string; accountId: string }[]
  /** Quoted amount (from the primary quotation). */
  quotedAmount: string | null
  /** Estimated Funnel Amount (manual) — drives the forecast. */
  estimatedAmount: string | null
  recognizedPercent: string | null
  currency: string
  /** Tenant currency picklist, for the inline Currency picker. */
  currencies: string[]
  /** A primary quotation locks the currency (its currency is frozen at send). */
  primaryQuotationId: string | null
  quoteNumber: string | null
  status: string
  projectNatureName: string | null
  /** Selected project-nature codes (raw, for the inline toggle editor). */
  projectNatureCodes: string[]
  /** The tenant's full project-nature picklist. */
  projectNatureCatalog: { code: string; name: string }[]
  funnelName: string | null
  description: string | null
  projectYear: number | null
  isIntercompany: boolean
  /** Handling partners on this deal, with live-resolved names. */
  parties: OpportunityDetail["parties"]
  /** Each party's accept/decline on their slice (origin view). */
  partnerResponses: OpportunityDetail["partnerResponses"]
  /** Other entities the user belongs to — the only valid intercompany partners. */
  entityOptions: Option[]
  expectedCloseDate: string | null
  /** Commit (4A) gate fields — required to advance into 4A. */
  procurementStage: string | null
  negotiationDone: boolean
  negotiationDate: string | null
  expectedInvoiceMonth: string | null
  expectedInvoiceYear: number | null
  createdAt: Date
  stageName: string
  stageKind: string
  stageProbability: string
  quotations: OpportunityDetail["quotations"]
  history: OpportunityDetail["history"]
  projects: OpportunityProjectRow[]
  products: OpportunityProductRow[]
  costs: DealCostRow[]
  /** Quoted revenue (base currency) margin is computed against. */
  costRevenue: number
  canManageCosts: boolean
  /** Gates the per-tab "New quotation" / "New project" related-list actions. */
  canCreateQuote: boolean
  canCreateProject: boolean
  /** Whether the caller can edit this Funnel (OPPORTUNITY_UPDATE) — gates every inline editor. */
  canEdit: boolean
  /** Whether the finance plugin (intercompany billing) is enabled. */
  financeEnabled: boolean
  /** Whether the projects plugin is enabled (gates the Projects related-list tab). */
  projectsEnabled: boolean
  contractYears: ContractYearRow[]
  projectNatureNames: string[]
  /** Resolved per-stage entry gate (preset + custom field completeness). */
  gate: StageGate
  /** Tenant custom field definitions + this funnel's stored values. */
  customFieldDefs: CustomFunnelField[]
  customValues: Record<string, string>
  activity: React.ComponentProps<typeof ActivityTimeline>["items"]
  documents: React.ComponentProps<typeof DocumentsSection>["documents"]
  /** Payment milestones attached to this funnel (core, funnel-scoped). */
  milestones: PaymentMilestoneRow[]
  /** Gates the milestones panel's add/edit/reorder/delete affordances. */
  canManageMilestones: boolean
  /** Every stage-approval request raised for this funnel, any status, newest first. */
  approvalHistory: ApprovalRow[]
}

/** Two-column detail: a rich details panel on the left, the clickable stage path
 *  plus a tabbed panel of related lists on the right (each top-5 + search). */
export function FunnelDetailBody(props: FunnelDetailData) {
  const {
    funnelId,
    currentStageId,
    stages,
    interactive,
    name,
    accountId,
    accountName,
    accountOptions,
    container,
    ownerMemberId,
    ownerName,
    members,
    personId,
    personName,
    persons,
    quotedAmount,
    estimatedAmount,
    recognizedPercent,
    currency,
    currencies,
    primaryQuotationId,
    quoteNumber,
    status,
    projectNatureName,
    projectNatureCodes,
    projectNatureCatalog,
    funnelName,
    description,
    projectYear,
    isIntercompany,
    parties,
    partnerResponses,
    entityOptions,
    expectedCloseDate,
    procurementStage,
    negotiationDone,
    negotiationDate,
    expectedInvoiceMonth,
    expectedInvoiceYear,
    createdAt,
    stageName,
    stageKind,
    stageProbability,
    quotations,
    history,
    projects,
    products,
    costs,
    costRevenue,
    canManageCosts,
    canCreateQuote,
    canCreateProject,
    canEdit,
    financeEnabled,
    projectsEnabled,
    contractYears,
    projectNatureNames,
    gate,
    customFieldDefs,
    customValues,
    activity,
    documents,
    milestones,
    canManageMilestones,
    approvalHistory,
  } = props

  // updateOpportunity is patch-style: send only the changed field.
  const saveField = useSaveField((patch: Partial<OpportunityInput>) =>
    updateOpportunity(funnelId, patch)
  )

  const contactOptions = React.useMemo(
    () =>
      persons.filter((p) => p.accountId === accountId).map((p) => ({ value: p.id, label: p.name })),
    [persons, accountId]
  )
  const memberOptions = React.useMemo(
    () => members.map((m) => ({ value: m.memberId, label: m.name })),
    [members]
  )
  const currencyLocked = !!primaryQuotationId
  const currencyOptions = React.useMemo(
    () => currencies.map((c) => ({ value: c, label: c })),
    [currencies]
  )

  // Single-select (radio-style): picking a pill replaces the selection;
  // clicking the selected pill clears it.
  function toggleNature(code: string) {
    saveField({ projectNatures: projectNatureCodes.includes(code) ? [] : [code] })
  }

  const [tab, setTab] = React.useState("activity")
  const revalidate = `/funnel/${funnelId}`

  // Recognized Amount = deal value × Recognized % (the tenant's cut). Once a
  // primary quotation exists its net IS the deal's real value, so the quoted
  // amount becomes the basis; before any quote, the rep's estimate is all we
  // have. The label states which basis applied.
  const recognizedBasis = quotedAmount ?? estimatedAmount
  const recognizedBasisLabel = quotedAmount ? "quoted" : "estimated"
  // Exact recognized money: when handling partners are authored, derive it from
  // their shares (basis − Σ shares) so a fixed-amount leg is exact to the cent
  // instead of round-tripping through the 2-decimal recognizedPercent. Fall
  // back to the stored percent only for legacy deals with no party rows.
  const recognizedAmount = (
    parties.length > 0
      ? deriveOriginRecognizedAmount(
          Number(recognizedBasis ?? 0),
          parties.map((p) => ({
            shareType: p.shareType,
            shareValue: Number(p.shareValue),
          }))
        )
      : (Number(recognizedBasis ?? 0) * Number(recognizedPercent ?? 0)) / 100
  ).toFixed(2)

  // Cost & margin tracker: part of the finance/intercompany economics. Margin
  // is measured against the RECOGNIZED cut for intercompany deals (so external
  // supplier costs reduce what we actually keep) and the whole quoted value
  // otherwise.
  const showCostMargin = financeEnabled
  const marginRevenue =
    isIntercompany && parties.length > 0 ? Number(recognizedAmount) : costRevenue
  const marginRevenueLabel =
    isIntercompany && parties.length > 0 ? "Recognized revenue" : "Quoted revenue"

  const quoteColumns = React.useMemo<ColumnDef<(typeof quotations)[number]>[]>(
    () => [
      {
        accessorKey: "quoteNumber",
        header: ({ column }) => <SortableHeader column={column} title="Number" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/quotations/${row.original.id}`}
              className="font-medium link"
            >
              {row.original.quoteNumber}
            </Link>
            {row.original.isPrimary ? (
              <Badge variant="outline">Primary</Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "total",
        header: rightHeader("Total"),
        cell: moneyCell<(typeof quotations)[number]>(
          (r) => r.total,
          (r) => r.currency
        ),
      },
    ],
    []
  )

  const projectColumns = React.useMemo<ColumnDef<OpportunityProjectRow>[]>(
    () => [
      {
        accessorKey: "projectCode",
        header: "Code",
        cell: ({ row }) => (
          <Link
            href={`/projects/${row.original.id}`}
            className="font-mono text-xs link"
          >
            {row.original.projectCode}
          </Link>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Name" />,
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    []
  )

  const productColumns = React.useMemo<ColumnDef<OpportunityProductRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} title="Product" />,
        cell: linkCell<OpportunityProductRow>(
          (r) => `/products/${r.productId}`,
          (r) => r.name
        ),
      },
      {
        accessorKey: "productCode",
        header: "Line",
        cell: ({ row }) =>
          row.original.productCode ? (
            <span className="font-mono text-xs">{row.original.productCode}</span>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "uom",
        header: "UOM",
        cell: ({ row }) => row.original.uom ?? "—",
      },
      {
        accessorKey: "quoteCount",
        header: rightHeader("On quotes"),
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.quoteCount}</div>
        ),
      },
    ],
    []
  )

  const historyColumns = React.useMemo<ColumnDef<(typeof history)[number]>[]>(
    () => [
      {
        accessorKey: "toStageName",
        header: "Stage",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 text-sm">
            {row.original.fromStageName ? (
              <>
                <span className="text-muted-foreground">
                  {row.original.fromStageName}
                </span>
                <span className="text-muted-foreground">→</span>
              </>
            ) : null}
            <span className="font-medium">{row.original.toStageName}</span>
          </div>
        ),
      },
      {
        accessorKey: "changedAt",
        header: ({ column }) => <SortableHeader column={column} title="When" />,
        cell: ({ row }) => formatDate(row.original.changedAt),
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) =>
          STAGE_SOURCE_LABELS[row.original.source] ?? row.original.source,
      },
      {
        accessorKey: "changedByName",
        header: "By",
        cell: ({ row }) => row.original.changedByName ?? "—",
      },
    ],
    []
  )

  const milestoneValueCeiling = quotedAmount ?? estimatedAmount ?? null

  // Field-level change log — a subset of the activity timeline (update rows
  // only), surfaced in its own tab so edits aren't lost in the note/call noise.
  const changes = React.useMemo(
    () => activity.filter((a) => a.type === "update"),
    [activity]
  )

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      {/* Left column — funnel highlights + related quick links */}
      <DetailAside>
        <Card>
          <DetailCardHeader kind="funnel" eyebrow="Funnel" />
          <CardContent className="grid gap-3 text-sm">
            {/* Salesforce "Opportunity Information" section (SPEC §4). */}
            <h3 className="text-sm font-semibold">Opportunity Information</h3>
            <FieldRow label="Account">
              {canEdit ? (
                <InlineCombobox
                  value={accountId}
                  display={accountName ?? "—"}
                  options={accountOptions.map((a) => ({ value: a.id, label: a.name }))}
                  onSave={(next) => saveField({ accountId: next, primaryPersonId: null })}
                  searchPlaceholder="Search accounts…"
                  emptyMessage="No accounts found."
                  title="Click to change account"
                />
              ) : accountName ? (
                <Link
                  href={`/accounts/${accountId}`}
                  className="font-medium link"
                >
                  {accountName}
                </Link>
              ) : (
                "—"
              )}
            </FieldRow>
            <FieldRow label="Opportunity">
              {container ? (
                <Link href={`/opportunities/${container.id}`} className="font-medium link">
                  {container.name}
                </Link>
              ) : (
                "—"
              )}
            </FieldRow>
            {container ? (
              <>
                <Separator />
                <h3 className="text-sm font-semibold">Opportunity Analysis (PPVVC)</h3>
                {PPVVC.map((f) => (
                  <FieldRow key={f.key} label={f.label}>
                    <span className="whitespace-pre-wrap">
                      {container[f.key] || "—"}
                    </span>
                  </FieldRow>
                ))}
              </>
            ) : null}
            <FieldRow label="Owner">
              {canEdit ? (
                <InlineCombobox
                  value={ownerMemberId}
                  display={ownerName ?? "—"}
                  options={memberOptions}
                  onSave={(next) => saveField({ ownerMemberId: next })}
                  searchPlaceholder="Search members…"
                  emptyMessage="No members found."
                  title="Click to change owner"
                />
              ) : (
                ownerName ?? "—"
              )}
            </FieldRow>
            <FieldRow label="Contact">
              {canEdit ? (
                <InlineCombobox
                  value={personId ?? ""}
                  display={personName ?? "—"}
                  options={contactOptions}
                  onSave={(next) => saveField({ primaryPersonId: next || null })}
                  placeholder="Optional"
                  searchPlaceholder="Search contacts…"
                  emptyMessage="No contacts for this account."
                  title="Click to change contact"
                />
              ) : personId && personName ? (
                <Link
                  href={`/persons/${personId}`}
                  className="link"
                >
                  {personName}
                </Link>
              ) : (
                personName ?? "—"
              )}
            </FieldRow>
            <FieldRow label="Project nature(s)">
              {canEdit ? (
                projectNatureCatalog.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No project natures configured. Add them in Settings.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {projectNatureCatalog.map((p) => {
                      const on = projectNatureCodes.includes(p.code)
                      return (
                        <button
                          key={p.code}
                          type="button"
                          onClick={() => toggleNature(p.code)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-muted-foreground hover:bg-accent"
                          )}
                        >
                          ({p.code}) - {p.name}
                        </button>
                      )
                    })}
                  </div>
                )
              ) : projectNatureNames.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {projectNatureNames.map((n) => (
                    <Badge key={n} variant="outline">
                      {n}
                    </Badge>
                  ))}
                </span>
              ) : (
                projectNatureName ?? "—"
              )}
            </FieldRow>

            <Separator />

            {/* Salesforce "Funnel Info" section (SPEC §4). */}
            <h3 className="text-sm font-semibold">Funnel Info</h3>
            <FieldRow label="Funnel Name">
              {canEdit ? (
                <InlineValue
                  value={name}
                  display={name}
                  title="Click to edit name"
                  onSave={(next) => {
                    if (!next.trim()) return
                    return saveField({ name: next })
                  }}
                  className="font-medium"
                />
              ) : (
                <span className="font-medium">{name}</span>
              )}
            </FieldRow>
            <FieldRow label="Funnel">{funnelName ?? "—"}</FieldRow>
            <FieldRow label="Stage">
              <StageBadge
                name={stageName}
                kind={stageKind}
                probability={stageProbability}
              />
            </FieldRow>
            <FieldRow label="Status">
              <StatusBadge status={status} />
            </FieldRow>
            <FieldRow label="Currency">
              {canEdit && !currencyLocked ? (
                <InlineCombobox
                  value={currency}
                  display={currency}
                  options={currencyOptions}
                  onSave={(next) => saveField({ currency: next })}
                  searchPlaceholder="Search currencies…"
                  title="Click to change currency"
                />
              ) : (
                <span title={currencyLocked ? "Locked to the primary quotation's currency." : undefined}>
                  {currency}
                </span>
              )}
            </FieldRow>

            {/* Value breakdown: estimated (forecast) vs quoted vs recognized. */}
            <FieldRow label="Estimated funnel amount">
              {canEdit ? (
                <InlineValue
                  value={estimatedAmount ?? ""}
                  display={estimatedAmount ? formatMoney(estimatedAmount, currency) : "—"}
                  formatDraft={(v) => formatMoney(v || "0", currency)}
                  type="number"
                  title="Click to edit estimated amount"
                  onSave={(next) => {
                    const value = next.trim()
                    if (!value) return saveField({ estimatedAmount: null })
                    if (!isValidMoneyInput(value)) {
                      throw new Error(
                        "Estimated amount must be a non-negative number with up to 2 decimals."
                      )
                    }
                    return saveField({ estimatedAmount: value })
                  }}
                  className="font-semibold tabular-nums"
                />
              ) : (
                <span className="font-semibold tabular-nums">
                  {estimatedAmount ? formatMoney(estimatedAmount, currency) : "—"}
                </span>
              )}
            </FieldRow>
            <FieldRow label="Quoted amount">
              {quotedAmount ? (
                <span className="tabular-nums">
                  {formatMoney(quotedAmount, currency)}
                  {quoteNumber ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      from {quoteNumber}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">No quotation yet</span>
              )}
            </FieldRow>
            {financeEnabled ? (
              <FieldRow label="Recognized">
                {canEdit && parties.length === 0 ? (
                  // Manual % override — recomputed from party shares (and thus
                  // locked here) once handling partners exist.
                  <InlineValue
                    value={recognizedPercent ?? ""}
                    display={
                      recognizedPercent ? (
                        <span className="tabular-nums">
                          {formatMoney(recognizedAmount, currency)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({Number(recognizedPercent)}% of {recognizedBasisLabel})
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Set recognized %</span>
                      )
                    }
                    formatDraft={(v) => (v ? `${Number(v)}%` : "—")}
                    type="number"
                    title="Click to edit recognized %"
                    onSave={(next) => {
                      const value = next.trim()
                      if (!value) return saveField({ recognizedPercent: null })
                      if (!isValidPercentInput(value)) {
                        throw new Error("Recognized % must be between 0 and 100.")
                      }
                      return saveField({ recognizedPercent: value })
                    }}
                  />
                ) : recognizedPercent ? (
                  <span className="tabular-nums">
                    {formatMoney(recognizedAmount, currency)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({Number(recognizedPercent)}% of {recognizedBasisLabel})
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </FieldRow>
            ) : null}

            {financeEnabled ? (
              <FieldRow label={`Handling partner${parties.length !== 1 ? "s" : ""}`}>
                <div className="grid gap-1.5">
                  {!isIntercompany || parties.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    parties.map((p) => {
                      const resp = partnerResponses.find(
                        (r) => r.partnerEntityId === p.partnerEntityId
                      )
                      const basis = Number(recognizedBasis ?? 0)
                      const share = partyShare(
                        { shareType: p.shareType, shareValue: Number(p.shareValue) },
                        basis,
                        basis
                      )
                      return (
                        <span
                          key={p.partnerEntityId}
                          className="inline-flex flex-wrap items-center gap-1.5"
                        >
                          <Badge variant="outline">Intercompany</Badge>
                          {p.partnerName}
                          <span className="text-xs text-muted-foreground">
                            {formatMoney(share.toFixed(2), currency)}
                          </span>
                          {resp ? (
                            <Badge
                              variant={
                                resp.response === "accepted"
                                  ? "default"
                                  : "destructive"
                              }
                              title={resp.reason ?? undefined}
                            >
                              {resp.response === "accepted"
                                ? "Accepted"
                                : "Declined"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Awaiting response</Badge>
                          )}
                        </span>
                      )
                    })
                  )}
                  {canEdit ? (
                    <IntercompanyDialog
                      funnelId={funnelId}
                      isIntercompany={isIntercompany}
                      parties={parties}
                      entityOptions={entityOptions}
                      currency={currency}
                      trigger={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 justify-self-start px-1.5 text-xs text-muted-foreground"
                        >
                          <PencilIcon className="size-3" />
                          Edit
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              </FieldRow>
            ) : null}

            <FieldRow label="Project / license year">
              {canEdit ? (
                <InlineValue
                  value={projectYear != null ? String(projectYear) : ""}
                  display={projectYear ?? "—"}
                  type="number"
                  title="Click to edit project year"
                  onSave={(next) =>
                    {
                      const value = next.trim()
                      if (!value) return saveField({ projectYear: null })
                      const year = Number(value)
                      if (!isValidYearInput(value) || !Number.isInteger(year)) {
                        throw new Error("Project / license year must be a 4-digit year.")
                      }
                      return saveField({ projectYear: year })
                    }
                  }
                />
              ) : (
                (projectYear ?? "—")
              )}
            </FieldRow>
            <FieldRow label="Expected close">
              {canEdit ? (
                <InlineValue
                  value={expectedCloseDate ?? ""}
                  display={formatDate(expectedCloseDate)}
                  formatDraft={(v) => (v ? formatDate(v) : "—")}
                  type="date"
                  title="Click to edit close date"
                  onSave={(next) => {
                    const value = next.trim()
                    if (!value) return saveField({ expectedCloseDate: null })
                    if (!isValidDateInput(value)) {
                      throw new Error(
                        "Expected close date must be a valid date in YYYY-MM-DD format."
                      )
                    }
                    return saveField({ expectedCloseDate: value })
                  }}
                />
              ) : (
                formatDate(expectedCloseDate)
              )}
            </FieldRow>
            <FieldRow label="Created">{formatDate(createdAt)}</FieldRow>
            <FieldRow label="Description">
              {canEdit ? (
                <InlineValue
                  value={description ?? ""}
                  display={description || "Add description"}
                  title="Click to edit description"
                  onSave={(next) => saveField({ description: next || null })}
                />
              ) : (
                description || "—"
              )}
            </FieldRow>

            <Separator />

            {/* Commit (4A) gate fields — the stage-advance checklist points here. */}
            <h3 id="procurement" className="text-sm font-semibold">
              Procurement &amp; Commit
            </h3>
            <FieldRow label="Procurement Process Stage">
              {canEdit ? (
                <InlineValue
                  value={procurementStage ?? ""}
                  display={procurementStage || "—"}
                  title="Click to edit procurement stage"
                  onSave={(next) => saveField({ procurementStage: next || null })}
                />
              ) : (
                procurementStage || "—"
              )}
            </FieldRow>
            <FieldRow label="Negotiation Done?">
              {canEdit ? (
                <Switch
                  checked={negotiationDone}
                  onCheckedChange={(v) => saveField({ negotiationDone: v })}
                />
              ) : negotiationDone ? (
                "Yes"
              ) : (
                "No"
              )}
            </FieldRow>
            <FieldRow label="Negotiation Date">
              {canEdit ? (
                <InlineValue
                  value={negotiationDate ?? ""}
                  display={formatDate(negotiationDate)}
                  formatDraft={(v) => (v ? formatDate(v) : "—")}
                  type="date"
                  title="Click to edit negotiation date"
                  onSave={(next) => saveField({ negotiationDate: next || null })}
                />
              ) : (
                formatDate(negotiationDate)
              )}
            </FieldRow>
            <FieldRow label="Expected Invoice">
              <span className="inline-flex flex-wrap items-center gap-2">
                {canEdit ? (
                  <>
                    <InlineCombobox
                      value={expectedInvoiceMonth ?? ""}
                      display={expectedInvoiceMonth || "Month"}
                      options={INVOICE_MONTHS}
                      onSave={(next) =>
                        saveField({ expectedInvoiceMonth: next || null })
                      }
                      placeholder="Month"
                      searchPlaceholder="Search months…"
                      title="Click to set expected invoice month"
                    />
                    <InlineValue
                      value={expectedInvoiceYear != null ? String(expectedInvoiceYear) : ""}
                      display={expectedInvoiceYear ?? "Year"}
                      type="number"
                      title="Click to set expected invoice year"
                      onSave={(next) =>
                        saveField({ expectedInvoiceYear: next ? Number(next) : null })
                      }
                    />
                  </>
                ) : (
                  <span>
                    {expectedInvoiceMonth && expectedInvoiceYear
                      ? `${expectedInvoiceMonth} ${expectedInvoiceYear}`
                      : "—"}
                  </span>
                )}
              </span>
            </FieldRow>

            {customFieldDefs.length > 0 ? (
              <>
                <Separator />
                {groupCustomFields(customFieldDefs).map((group) => (
                  <React.Fragment key={group.category ?? "__none__"}>
                    {group.category ? (
                      <div className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.category}
                      </div>
                    ) : null}
                    {group.fields.map((def) => (
                      <FieldRow key={def.key} label={def.label}>
                        <CustomFieldValue
                          def={def}
                          value={customValues[def.key] ?? ""}
                          canEdit={canEdit}
                          onSave={(next) =>
                            saveField({
                              customFields: { ...customValues, [def.key]: next },
                            })
                          }
                        />
                      </FieldRow>
                    ))}
                  </React.Fragment>
                ))}
              </>
            ) : null}
          </CardContent>
        </Card>

        <RelatedCard
          items={[
            ...(container
              ? [{ kind: "opportunity" as const, label: "Opportunity", href: `/opportunities/${container.id}` }]
              : []),
            { kind: "quotation", label: "Quotations", count: quotations.length, onSelect: () => setTab("quotations") },
            { kind: "product", label: "Products", count: products.length, onSelect: () => setTab("products") },
            { kind: "milestone", label: "Payment Milestones", count: milestones.length, onSelect: () => setTab("milestones") },
            ...(projectsEnabled
              ? [{ kind: "project" as const, label: "Projects", count: projects.length, onSelect: () => setTab("projects") }]
              : []),
            ...(showCostMargin
              ? [{ kind: "account" as const, label: "Costs & margin", count: costs.length, onSelect: () => setTab("costs") }]
              : []),
            ...(SHOW_CONTRACT
              ? [{ kind: "funnel" as const, label: "Contract", count: contractYears.length, onSelect: () => setTab("contract") }]
              : []),
          ]}
        />
      </DetailAside>

      {/* Right column — stage path + tabbed related lists */}
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <StagePath
              funnelId={funnelId}
              currentStageId={currentStageId}
              stages={stages}
              interactive={interactive}
              gate={gate}
              customFieldDefs={customFieldDefs}
              customValues={customValues}
            />
          </CardContent>
        </Card>

        <TabsCard value={tab} onValueChange={setTab}>
              <TabsList>

                <CountTab value="activity">Activity</CountTab>
                <CountTab value="quotations" count={quotations.length}>
                  Quotations
                </CountTab>
                <CountTab value="products" count={products.length}>
                  Products
                </CountTab>
                <CountTab value="milestones" count={milestones.length}>
                  Payment Milestones
                </CountTab>
                {projectsEnabled ? (
                  <CountTab value="projects" count={projects.length}>
                    Projects
                  </CountTab>
                ) : null}
                {showCostMargin ? (
                  <CountTab value="costs" count={costs.length}>
                    Costs &amp; margin
                  </CountTab>
                ) : null}
                {SHOW_CONTRACT ? (
                  <CountTab value="contract" count={contractYears.length}>
                    Contract
                  </CountTab>
                ) : null}
                <CountTab value="history">Stage history</CountTab>
                <CountTab value="approvals" count={approvalHistory.length}>
                  Approval history
                </CountTab>
                <CountTab value="changes" count={changes.length}>
                  History
                </CountTab>
                <CountTab value="documents" count={documents.length}>
                  Documents
                </CountTab>
              </TabsList>

              <TabsContent value="activity" className="mt-4">
                <ActivityTimeline
                  entityType="opportunity"
                  entityId={funnelId}
                  items={activity}
                  revalidate={revalidate}
                />
              </TabsContent>

              <TabsContent value="quotations" className="mt-4">
                <DataTable
                  columns={quoteColumns}
                  data={quotations}
                  tableId="funnel-quotes"
                  searchColumn="quoteNumber"
                  searchPlaceholder="Search quotations…"
                  emptyMessage="No quotations yet."
                  pageSize={5}
                  toolbar={
                    canCreateQuote ? (
                      <Button
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link href={`/quotations/new?funnelId=${funnelId}`} />
                        }
                      >
                        <Plus className="size-4" />
                        Add quotation
                      </Button>
                    ) : undefined
                  }
                />
              </TabsContent>

              <TabsContent value="products" className="mt-4">
                <DataTable
                  columns={productColumns}
                  data={products}
                  tableId="funnel-products"
                  searchColumn="name"
                  searchPlaceholder="Search products…"
                  emptyMessage="No products offered yet — add products to a quotation."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="milestones" className="mt-4">
                <MilestonesPanel
                  milestones={milestones as MilestoneItemBase[]}
                  valueCeiling={milestoneValueCeiling}
                  valueCeilingLabel="net funnel value, ex-tax"
                  currency={currency}
                  canManage={canManageMilestones}
                  onCreate={(values) =>
                    createFunnelMilestone({ funnelId, ...values })
                  }
                  onUpdate={(id, values) => updateFunnelMilestone(id, values)}
                  onDelete={(id) => deleteFunnelMilestone(id)}
                  onReorder={(order) => reorderFunnelMilestones(funnelId, order)}
                  onSplit={(parts) => splitFunnelMilestones(funnelId, parts)}
                />
              </TabsContent>

              {projectsEnabled ? (
                <TabsContent value="projects" className="mt-4">
                  <DataTable
                    columns={projectColumns}
                    data={projects}
                    tableId="funnel-projects"
                    searchColumn="name"
                    searchPlaceholder="Search projects…"
                    emptyMessage="No projects from this funnel yet."
                    pageSize={5}
                    toolbar={
                      canCreateProject ? (
                        <Button
                          size="sm"
                          nativeButton={false}
                          render={
                            <Link
                              href={`/projects/new?funnelId=${funnelId}&accountId=${accountId}`}
                            />
                          }
                        >
                          <Plus className="size-4" />
                          Add project
                        </Button>
                      ) : undefined
                    }
                  />
                </TabsContent>
              ) : null}

              {showCostMargin ? (
                <TabsContent value="costs" className="mt-4">
                  <CostsPanel
                    funnelId={funnelId}
                    costs={costs}
                    revenue={marginRevenue}
                    revenueLabel={marginRevenueLabel}
                    currency={currency}
                    currencies={currencies}
                    canManage={canManageCosts}
                  />
                </TabsContent>
              ) : null}

              {SHOW_CONTRACT ? (
                <TabsContent value="contract" className="mt-4">
                  <ContractPanel
                    funnelId={funnelId}
                    years={contractYears}
                    currency={currency}
                    canManage={canManageCosts}
                  />
                </TabsContent>
              ) : null}

              <TabsContent value="history" className="mt-4">
                <DataTable
                  columns={historyColumns}
                  data={history}
                  tableId="funnel-history"
                  searchColumn="toStageName"
                  searchPlaceholder="Search stage history…"
                  emptyMessage="No stage changes recorded."
                  pageSize={5}
                />
              </TabsContent>

              <TabsContent value="approvals" className="mt-4">
                {approvalHistory.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No approval requests yet.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {approvalHistory.map((row) => (
                      <ApprovalHistoryEntry key={row.id} row={row} />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="changes" className="mt-4">
                <ChangeHistory items={changes} />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <DocumentsSection
                  uploadType="opportunity"
                  uploadId={funnelId}
                  documents={documents}
                  revalidate={revalidate}
                />
              </TabsContent>
        </TabsCard>
      </div>
    </div>
  )
}

/** A tenant custom field's value, inline-editable per its configured type. */
function CustomFieldValue({
  def,
  value,
  canEdit,
  onSave,
}: {
  def: CustomFunnelField
  value: string
  canEdit: boolean
  onSave: (next: string) => Promise<void> | void
}) {
  if (!canEdit) return formatCustomFieldValue(def, value)

  if (def.type === "checkbox") {
    return (
      <Switch
        checked={value === "true"}
        onCheckedChange={(c) => onSave(c ? "true" : "false")}
      />
    )
  }
  if (def.type === "select") {
    return (
      <InlineCombobox
        value={value}
        display={value || "—"}
        options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
        onSave={onSave}
        placeholder="Select…"
        title={`Click to edit ${def.label}`}
      />
    )
  }
  return (
    <InlineValue
      value={value}
      display={formatCustomFieldValue(def, value)}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
      title={`Click to edit ${def.label}`}
      onSave={onSave}
    />
  )
}
