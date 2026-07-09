import Link from "next/link"
import { notFound } from "next/navigation"
import { FolderPlusIcon, ClockIcon, FileTextIcon } from "lucide-react"

import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { isModuleEnabled } from "@/lib/modules"
import {
  listAccountOptions,
  listMembers,
  listFunnelsWithStages,
  listProjectNatures,
  listCustomFunnelFields,
  listEntities,
  listCurrencies,
} from "@/lib/lookups"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { listActivities } from "@/app/(app)/_shared/activity-actions"
import { listOpportunityDocuments } from "@/app/(app)/_shared/attachment-actions"
import {
  getOpportunity,
  listOpportunityProjects,
  listOpportunityProducts,
  listPersonsWithAccount,
  type OpportunityListRow,
} from "../actions"
import { listFunnelMilestones } from "@/app/(app)/payment-milestones/actions"
import { buildStageGate } from "@/lib/stage-gate"
import { StageAdvanceDialog } from "../stage-advance-dialog"
import { StageReopenDialog } from "../stage-reopen-dialog"
import { OpportunityForm } from "../opportunity-form"
import { isTerminalKind, selectableTargets } from "../stage-transitions"
import { listDealCosts } from "../cost-actions"
import { listContractYears } from "../contract-actions"
import { FunnelDetailBody } from "./funnel-detail-body"

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getOpportunity(id)
  if (!detail) notFound()

  const { opportunity: opp, accountName, container, ownerName, personName, stage } = detail

  const [
    ctx,
    accounts,
    persons,
    members,
    pipelines,
    projectNatures,
    customFunnelFields,
    activity,
    documents,
    relatedProjects,
    relatedProducts,
    dealCosts,
    contractYears,
    entities,
    currencies,
    milestones,
  ] = await Promise.all([
    requireContext(),
    listAccountOptions(),
    listPersonsWithAccount(),
    listMembers(),
    listFunnelsWithStages(),
    listProjectNatures(),
    listCustomFunnelFields(),
    listActivities("opportunity", id),
    listOpportunityDocuments(id),
    listOpportunityProjects(id),
    listOpportunityProducts(id),
    listDealCosts(id),
    listContractYears(id),
    listEntities(),
    listCurrencies(),
    listFunnelMilestones(id),
  ])

  // Resolve the project-nature display name for the overview (falls back to the
  // raw code if the picklist entry was renamed/removed).
  const natureName = (code: string) =>
    projectNatures.find((p) => p.code === code)?.name ?? code
  const projectNatureName = opp.projectNatureCode
    ? natureName(opp.projectNatureCode)
    : null
  // The full set of natures this deal covers (display names).
  const projectNatureNames = (
    opp.projectNatures ?? (opp.projectNatureCode ? [opp.projectNatureCode] : [])
  ).map(natureName)

  // Funnel completeness — drives the per-stage entry-requirement gate. Presets
  // read real columns; custom fields read opp.customFields against the tenant's
  // custom field definitions.
  const gate = buildStageGate(
    {
      hasEstimate:
        opp.estimatedAmount != null && Number(opp.estimatedAmount) > 0,
      hasCloseDate: !!opp.expectedCloseDate,
      hasContact: !!opp.primaryPersonId,
      hasNature: projectNatureNames.length > 0,
      hasQuote: !!opp.primaryQuotationId,
    },
    (opp.customFields ?? {}) as Record<string, unknown>,
    customFunnelFields
  )

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
  const canCreateProject =
    isModuleEnabled("projects") && ctx.can(PERMISSIONS.PROJECT_CREATE)

  // Build the list-shaped row the edit form expects from the detail payload.
  const editRow: OpportunityListRow = {
    id: opp.id,
    name: opp.name,
    accountId: opp.accountId,
    accountName,
    amount: opp.amount,
    estimatedAmount: opp.estimatedAmount,
    recognizedPercent: opp.recognizedPercent,
    description: opp.description,
    projectYear: opp.projectYear,
    isIntercompany: opp.isIntercompany,
    parties: detail.parties,
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
    pipelineId: opp.pipelineId,
    pipelineIsDefault:
      pipelines.find((f) => f.id === opp.pipelineId)?.isDefault ?? false,
    primaryQuotationId: opp.primaryQuotationId,
    projectNatureCode: opp.projectNatureCode,
    projectNatures: opp.projectNatures,
    customFields: opp.customFields ?? {},
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
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/quotations/new?funnelId=${opp.id}`} />
                }
              >
                <FileTextIcon />
                New quotation
              </Button>
            ) : null}
            {canCreateProject ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/projects/new?funnelId=${opp.id}&accountId=${opp.accountId}`}
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
                pipelines={pipelines}
                projectNatures={projectNatures}
                customFieldDefs={customFunnelFields}
                entityOptions={entities}
                financeEnabled={isModuleEnabled("finance")}
                currencies={currencies}
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
                  funnelId={opp.id}
                  stages={detail.funnelStagesList}
                />
              ) : null
            ) : selectable.length === 0 ? (
              <Button variant="outline" disabled>
                No further stages available
              </Button>
            ) : (
              <StageAdvanceDialog
                funnelId={opp.id}
                currentStageId={opp.currentStageId}
                stages={detail.funnelStagesList}
                gate={gate}
                customFieldDefs={customFunnelFields}
                customValues={(opp.customFields ?? {}) as Record<string, string>}
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

        <FunnelDetailBody
          funnelId={opp.id}
          currentStageId={opp.currentStageId}
          stages={detail.funnelStagesList}
          interactive={canAdvance && !terminal && !pendingApproval}
          accountId={opp.accountId}
          accountName={accountName}
          container={container}
          ownerName={ownerName}
          personId={opp.primaryPersonId}
          personName={personName}
          quotedAmount={opp.amount}
          estimatedAmount={opp.estimatedAmount}
          recognizedPercent={opp.recognizedPercent}
          currency={opp.currency}
          quoteNumber={detail.quoteNumber}
          status={opp.status}
          projectNatureName={projectNatureName}
          funnelName={pipelines.find((f) => f.id === opp.pipelineId)?.name ?? null}
          description={opp.description}
          projectYear={opp.projectYear}
          isIntercompany={opp.isIntercompany}
          parties={detail.parties}
          partnerResponses={detail.partnerResponses}
          expectedCloseDate={opp.expectedCloseDate}
          createdAt={opp.createdAt}
          stageName={stage.name}
          stageKind={stage.kind}
          stageProbability={stage.probability}
          quotations={detail.quotations}
          history={detail.history}
          projects={relatedProjects}
          products={relatedProducts}
          costs={dealCosts}
          costRevenue={Number(opp.amount ?? opp.estimatedAmount ?? 0)}
          canManageCosts={canUpdate}
          canCreateQuote={canCreateQuote}
          canCreateProject={canCreateProject}
          financeEnabled={isModuleEnabled("finance")}
          projectsEnabled={isModuleEnabled("projects")}
          contractYears={contractYears}
          projectNatureNames={projectNatureNames}
          gate={gate}
          customFieldDefs={customFunnelFields}
          customValues={(opp.customFields ?? {}) as Record<string, string>}
          activity={activity}
          documents={documents}
          milestones={milestones}
        />

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
