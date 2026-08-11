import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { listAccountOptions } from "@/lib/lookups"
import { requireContext } from "@/lib/server-context"
import { requireEntitledRoute } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import {
  listOpportunityOptions,
  listProjectCreateMeta,
  listProjects,
  prefillFromOpportunity,
} from "./actions"
import { ProjectCreateForm } from "./project-create-form"
import { ProjectsTable } from "./projects-table"

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string
    accountId?: string
    funnelId?: string
    quotationId?: string
  }>
}) {
  await requireEntitledRoute("projects")
  const [rows, ctx, sp] = await Promise.all([
    listProjects(),
    requireContext(),
    searchParams,
  ])

  let newButton: React.ReactNode
  if (ctx.can(PERMISSIONS.PROJECT_CREATE)) {
    const [accounts, funnels, meta] = await Promise.all([
      listAccountOptions(),
      listOpportunityOptions(),
      listProjectCreateMeta(),
    ])

    // Prefill from query (?new=1 deep links): explicit opportunity wins and
    // derives its account.
    let defaultAccountId = sp.accountId
    const defaultOpportunityId = sp.funnelId

    // When created from a funnel, pre-fill name + value + linked quotation from
    // the opportunity's source quote (net of tax) so the user mostly just picks
    // the project nature. The value stays EDITABLE.
    let defaultName: string | undefined
    let defaultValue: string | undefined
    let defaultCurrency: string | undefined
    // Project nature DERIVED from the source quotation/funnel; from scratch it
    // suggests the tenant's first project nature. Editable in the form either way.
    let defaultProjectNatureCode: string | undefined = meta.projectNatures[0]?.code
    // A bare ?quotationId= (no funnel) still links the source quote on the project.
    let defaultQuotationId: string | undefined = sp.quotationId
    let prefillQuoteNumber: string | undefined
    // Code year segment defaults to the current year, but a deal prefill keys it
    // to the source funnel's contract/license year (matches nextProjectCode).
    let codeYear = meta.year
    if (defaultOpportunityId) {
      const prefill = await prefillFromOpportunity(defaultOpportunityId)
      if (prefill) {
        defaultAccountId = prefill.accountId
        defaultName = prefill.opportunityName
        defaultValue = prefill.value
        defaultCurrency = prefill.currency
        defaultProjectNatureCode = prefill.projectNatureCode || defaultProjectNatureCode
        defaultQuotationId = prefill.quotationId ?? defaultQuotationId
        prefillQuoteNumber = prefill.quoteNumber ?? undefined
        if (prefill.projectYear && prefill.projectYear > 0) codeYear = prefill.projectYear
      } else {
        // Fall back to deriving the account from the funnel options.
        const opp = funnels.find((o) => o.id === defaultOpportunityId)
        if (opp) {
          defaultAccountId = opp.accountId
          defaultName = opp.name
        }
      }
    }

    newButton = (
      <ProjectCreateForm
        accounts={accounts}
        funnels={funnels}
        projectNatures={meta.projectNatures}
        entityCode={meta.entityCode}
        codeYear={codeYear}
        accountCodes={meta.accountCodes}
        defaultName={defaultName}
        defaultAccountId={defaultAccountId}
        defaultOpportunityId={defaultOpportunityId}
        defaultProjectNatureCode={defaultProjectNatureCode}
        defaultValue={defaultValue}
        defaultCurrency={defaultCurrency}
        defaultQuotationId={defaultQuotationId}
        prefillQuoteNumber={prefillQuoteNumber}
        defaultOpen={sp.new === "1"}
        trigger={<Button>New project</Button>}
      />
    )
  }

  return (
    <>
      <SiteHeader title="Projects" />
      <PageBody>
        <ProjectsTable data={rows} toolbar={newButton} />
      </PageBody>
    </>
  )
}
