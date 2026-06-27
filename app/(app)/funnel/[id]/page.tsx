import Link from "next/link"
import { notFound } from "next/navigation"
import {
  FolderPlusIcon,
  FolderIcon,
  ClockIcon,
} from "lucide-react"

import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
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
import { DocumentsSection } from "@/components/documents-section"
import {
  StageProgress,
  buildFunnelSteps,
} from "@/components/stage-progress"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listOpportunityDocuments } from "@/app/(app)/_shared/attachment-actions"
import { formatDate, formatMoney, formatPercent } from "@/lib/format"
import {
  getOpportunity,
  listOpportunityProjects,
  listPersonsWithAccount,
  type OpportunityListRow,
} from "../actions"
import { StageBadge } from "../stage-badge"
import { StageAdvanceDialog } from "../stage-advance-dialog"
import { StageReopenDialog } from "../stage-reopen-dialog"
import { OpportunityForm } from "../opportunity-form"
import { isTerminalKind, selectableTargets } from "../stage-transitions"
import { QuotationCreateDialog } from "@/app/(app)/quotations/quotation-create-dialog"

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
  reopen: "Reopened",
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
    documents,
    relatedProjects,
  ] = await Promise.all([
    requireContext(),
    listAccountOptions(),
    listPersonsWithAccount(),
    listMembers(),
    listFunnelsWithStages(),
    listActivities("opportunity", id),
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

  // Stage-action state: a closed (terminal) deal can't advance — only a parked
  // or lost one can be reopened; an open deal with no legal forward target shows
  // a disabled hint; a pending approval freezes the CTA until it's decided.
  const terminal = isTerminalKind(stage.kind)
  const reopenable = stage.kind === "PARKED" || stage.kind === "LOST"
  const selectable = selectableTargets(
    detail.funnelStagesList.map((s) => ({
      id: s.id,
      kind: s.kind,
      sortOrder: s.sortOrder,
    })),
    opp.currentStageId
  )
  const pendingApproval = detail.pendingApproval

  // Per-affordance gates — mirrors the server-action permission checks so a
  // read-only role sees a clean detail view with no create/edit/advance CTAs.
  const canUpdate = ctx.can(PERMISSIONS.OPPORTUNITY_UPDATE)
  const canAdvance = ctx.can(PERMISSIONS.STAGE_ADVANCE)
  const canCreateQuote = ctx.can(PERMISSIONS.QUOTATION_CREATE)
  const canCreateProject = ctx.can(PERMISSIONS.PROJECT_CREATE)

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
            {canCreateQuote ? (
              <QuotationCreateDialog opportunityId={opp.id} />
            ) : null}
            {canCreateProject ? (
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
            ) : null}
            {canUpdate ? (
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
            ) : null}
            {pendingApproval ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/approvals" />}
              >
                <ClockIcon />
                Awaiting approval
              </Button>
            ) : !canAdvance ? null : terminal ? (
              reopenable ? (
                <StageReopenDialog
                  opportunityId={opp.id}
                  stages={detail.funnelStagesList}
                />
              ) : null
            ) : selectable.length === 0 ? (
              <Button variant="outline" disabled>
                No further stages available
              </Button>
            ) : (
              <StageAdvanceDialog
                opportunityId={opp.id}
                currentStageId={opp.currentStageId}
                stages={detail.funnelStagesList}
              />
            )}
          </div>
        </div>

        {pendingApproval ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <ClockIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Pending approval{" "}
              <span className="text-muted-foreground">→</span>{" "}
              <span className="font-medium">
                {pendingApproval.targetStageName}
              </span>
              . This Funnel can&apos;t advance until the request is decided.
            </span>
            <Link href="/approvals" className="font-medium underline">
              View in Approvals
            </Link>
          </div>
        ) : null}

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
                    Net value
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

            {/* Unified documents — files attached to this funnel plus the
                rolled-up files from its quotations and stage approvals. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentsSection
                  uploadType="opportunity"
                  uploadId={id}
                  documents={documents}
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
