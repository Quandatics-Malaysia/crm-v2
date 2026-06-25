import Link from "next/link"
import { notFound } from "next/navigation"
import {
  FileTextIcon,
  FolderPlusIcon,
  FolderIcon,
  DownloadIcon,
  PaperclipIcon,
} from "lucide-react"

import { requireContext } from "@/lib/server-context"
import {
  listAccountOptions,
  listMembers,
  listFunnelsWithStages,
} from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { ActivityTimeline } from "@/components/activity/activity-timeline"
import { AttachmentsPanel } from "@/components/attachments/attachments-panel"
import {
  StageProgress,
  buildFunnelSteps,
} from "@/components/stage-progress"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import {
  listEntityAttachments,
  listOpportunityDocuments,
} from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney, formatPercent } from "@/lib/format"
import {
  getOpportunity,
  listOpportunityProjects,
  listPersonsWithAccount,
  type OpportunityListRow,
} from "../actions"
import { StageBadge } from "../stage-badge"
import { StageAdvanceDialog } from "../stage-advance-dialog"
import { OpportunityForm } from "../opportunity-form"
import { RecordSoDialog } from "./record-so-dialog"

const quoteStatusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  sent: "secondary",
  accepted: "default",
  rejected: "destructive",
  expired: "outline",
  void: "outline",
}

const sourceLabel: Record<string, string> = {
  manual: "Manual",
  approval: "Via approval",
  quote_accept: "Quote accepted",
}

const docSourceVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  Funnel: "secondary",
  Quotation: "default",
  Approval: "outline",
}

const projectStatusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  planning: "outline",
  active: "default",
  on_hold: "secondary",
  completed: "secondary",
  cancelled: "destructive",
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getOpportunity(id)
  if (!detail) notFound()

  const { opportunity: opp, accountName, ownerName, personName, stage } = detail

  const [
    ctx,
    accounts,
    persons,
    members,
    funnels,
    activity,
    files,
    documents,
    relatedProjects,
  ] = await Promise.all([
    requireContext(),
    listAccountOptions(),
    listPersonsWithAccount(),
    listMembers(),
    listFunnelsWithStages(),
    listActivities("opportunity", id),
    listEntityAttachments("opportunity", id),
    listOpportunityDocuments(id),
    listOpportunityProjects(id),
  ])

  // Stage progress ladder, built from this funnel's stages.
  const progressStages = detail.funnelStagesList.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    sortOrder: s.sortOrder,
  }))
  const funnelProgress = buildFunnelSteps(progressStages, opp.currentStageId)

  // Build the list-shaped row the edit form expects from the detail payload.
  const editRow: OpportunityListRow = {
    id: opp.id,
    name: opp.name,
    accountId: opp.accountId,
    accountName,
    amount: opp.amount,
    currency: opp.currency,
    status: opp.status,
    expectedCloseDate: opp.expectedCloseDate,
    ownerMemberId: opp.ownerMemberId,
    ownerName,
    stageId: stage.id,
    stageName: stage.name,
    stageKind: stage.kind,
    stageProbability: stage.probability,
    stageSortOrder: stage.sortOrder,
    funnelId: opp.funnelId,
    funnelIsDefault:
      funnels.find((f) => f.id === opp.funnelId)?.isDefault ?? false,
    primaryQuotationId: opp.primaryQuotationId,
  }

  const soNumber = opp.soNumber?.trim() ?? ""
  const hasSoNumber = soNumber.length > 0
  // A Won / Invoiced funnel must carry an SO number backed by a document.
  const isWon = stage.kind === "WON" || opp.status === "won"
  const soRequiredWarning = isWon && !hasSoNumber

  return (
    <>
      <SiteHeader
        title={opp.name}
        breadcrumbs={[{ label: "Funnel", href: "/funnel" }, { label: opp.name }]}
      />
      <PageBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{opp.name}</h2>
            <p className="text-sm text-muted-foreground capitalize">
              {opp.status.replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={`/quotations/new?opportunityId=${opp.id}`} />
              }
            >
              <FileTextIcon />
              Create quotation
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/projects/new?opportunityId=${opp.id}&accountId=${opp.accountId}`}
                />
              }
            >
              <FolderPlusIcon />
              Create project
            </Button>
            <OpportunityForm
              mode="edit"
              accounts={accounts}
              persons={persons}
              members={members}
              funnels={funnels}
              defaultOwnerMemberId={ctx.memberId}
              opportunity={editRow}
              trigger={<Button variant="outline">Edit</Button>}
            />
            <StageAdvanceDialog
              opportunityId={opp.id}
              currentStageId={opp.currentStageId}
              stages={detail.funnelStagesList}
            />
            {!hasSoNumber ? (
              <RecordSoDialog
                opportunityId={opp.id}
                trigger={
                  <Button variant={soRequiredWarning ? "default" : "outline"}>
                    Record SO
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 lg:col-span-2">
            {/* Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overview</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-4">
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Account</span>
                  <Link
                    href={`/accounts/${opp.accountId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {accountName}
                  </Link>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Stage</span>
                  <StageBadge
                    name={stage.name}
                    kind={stage.kind}
                    probability={stage.probability}
                  />
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    Net deal value
                  </span>
                  {detail.amountFromQuote && detail.quoteNumber ? (
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">
                        {opp.amount
                          ? formatMoney(opp.amount, opp.currency)
                          : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        from quotation {detail.quoteNumber}
                      </span>
                    </span>
                  ) : (
                    <span className="grid gap-0.5">
                      <span className="text-sm font-semibold tabular-nums">
                        —
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Add a quotation to set the value.
                      </span>
                    </span>
                  )}
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <Badge variant="secondary" className="capitalize">
                    {opp.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    SO Number
                  </span>
                  {hasSoNumber ? (
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {soNumber}
                    </span>
                  ) : soRequiredWarning ? (
                    <Badge variant="destructive">
                      Record SO — attach signed PO/quotation
                    </Badge>
                  ) : (
                    <span className="text-sm">—</span>
                  )}
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Owner</span>
                  <span className="text-sm">{ownerName ?? "—"}</span>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Contact</span>
                  <span className="text-sm">{personName ?? "—"}</span>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    Expected close
                  </span>
                  <span className="text-sm">
                    {formatDate(opp.expectedCloseDate)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Stage progress */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stage progress</CardTitle>
              </CardHeader>
              <CardContent>
                <StageProgress
                  steps={funnelProgress.steps}
                  note={funnelProgress.note}
                />
              </CardContent>
            </Card>

            {/* Related projects */}
            {relatedProjects.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Project(s)</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {relatedProjects.map((p) => (
                    <Button
                      key={p.id}
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/projects/${p.id}`} />}
                    >
                      <FolderIcon />
                      <span className="font-mono">{p.projectCode}</span> ·{" "}
                      {p.name}
                      <Badge
                        variant={projectStatusVariant[p.status] ?? "secondary"}
                        className="ml-1 capitalize"
                      >
                        {p.status.replace(/_/g, " ")}
                      </Badge>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {/* Quotations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quotations</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.quotations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No quotations yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Number</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.quotations.map((q) => (
                        <TableRow key={q.id}>
                          <TableCell>
                            <Link
                              href={`/quotations/${q.id}`}
                              className="font-medium hover:underline"
                            >
                              {q.quoteNumber}
                            </Link>
                            {q.isPrimary ? (
                              <Badge variant="outline" className="ml-2">
                                Primary
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                quoteStatusVariant[q.status] ?? "secondary"
                              }
                              className="capitalize"
                            >
                              {q.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(q.total, q.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Stage history timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stage history</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No stage changes recorded.
                  </p>
                ) : (
                  <ol className="relative ml-2 border-l">
                    {detail.history.map((h) => (
                      <li key={h.id} className="mb-5 ml-4 last:mb-0">
                        <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" />
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {h.fromStageName ? (
                            <>
                              <span className="text-muted-foreground">
                                {h.fromStageName}
                              </span>
                              <span className="text-muted-foreground">→</span>
                            </>
                          ) : null}
                          <span className="font-medium">{h.toStageName}</span>
                          {h.probabilityAtChange != null ? (
                            <span className="text-xs text-muted-foreground">
                              {formatPercent(h.probabilityAtChange)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDate(h.changedAt)}</span>
                          <Separator
                            orientation="vertical"
                            className="h-3 data-vertical:self-auto"
                          />
                          <span>{sourceLabel[h.source] ?? h.source}</span>
                          {h.changedByName ? (
                            <>
                              <Separator
                                orientation="vertical"
                                className="h-3 data-vertical:self-auto"
                              />
                              <span>{h.changedByName}</span>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4">
            {/* Activity timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityTimeline
                  entityType="opportunity"
                  entityId={id}
                  items={activity}
                  revalidate={`/funnel/${id}`}
                />
              </CardContent>
            </Card>

            {/* Centralized documents — aggregates files from the funnel,
                its quotations, and stage-approval requests. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documents</CardTitle>
              </CardHeader>
              <CardContent>
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No documents across this funnel, its quotations, or
                    approvals yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{d.fileName}</span>
                          <Badge
                            variant={docSourceVariant[d.source] ?? "secondary"}
                            className="shrink-0"
                          >
                            {d.source}
                          </Badge>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {fmtBytes(d.byteSize)}
                          </span>
                        </span>
                        <a
                          href={`/api/files/${d.id}`}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                          download
                        >
                          <DownloadIcon className="size-3.5" />
                          Download
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Attachments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Attachments</CardTitle>
              </CardHeader>
              <CardContent>
                <AttachmentsPanel
                  attachableType="opportunity"
                  attachableId={id}
                  items={files}
                  revalidate={`/funnel/${id}`}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/funnel" />}
          >
            Back to funnel
          </Button>
        </div>
      </PageBody>
    </>
  )
}
