import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listAccountOptions } from "@/lib/lookups"
import { requireContext } from "@/lib/server-context"
import { requireModule } from "@/lib/module-guard"
import { PERMISSIONS } from "@/lib/permissions"
import {
  listOpportunityOptions,
  listProjectCreateMeta,
  prefillFromOpportunity,
} from "../actions"
import { ProjectCreateForm } from "../project-create-form"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountId?: string
    opportunityId?: string
    quotationId?: string
  }>
}) {
  requireModule("projects")
  const ctx = await requireContext()
  // No create permission -> there's no affordance to land here; bounce back.
  if (!ctx.can(PERMISSIONS.PROJECT_CREATE)) redirect("/projects")
  const sp = await searchParams
  const [accounts, opportunities, meta] = await Promise.all([
    listAccountOptions(),
    listOpportunityOptions(),
    listProjectCreateMeta(),
  ])

  // Prefill from query: explicit opportunity wins and derives its account.
  let defaultAccountId = sp.accountId
  const defaultOpportunityId = sp.opportunityId

  // When created from a funnel, pre-fill name + value + linked quotation from the
  // opportunity's source quote (net of tax) so the user mostly just picks the
  // project nature. The value stays EDITABLE.
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
      const opp = opportunities.find((o) => o.id === defaultOpportunityId)
      if (opp) {
        defaultAccountId = opp.accountId
        defaultName = opp.name
      }
    }
  }

  const fromQuote = Boolean(defaultOpportunityId || defaultQuotationId)

  return (
    <>
      {/* Title lives only in the top bar; the body shows a one-line nudge
          instead of repeating "New project" as a second heading. */}
      <SiteHeader
        title="New project"
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          { label: "New project" },
        ]}
      />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          {fromQuote
            ? "From the accepted quotation — account, value and project nature are prefilled; review and create."
            : "The project nature is suggested from your settings and feeds the project code — adjust if needed."}
        </p>
        <ProjectCreateForm
          accounts={accounts}
          opportunities={opportunities}
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
        />
      </PageBody>
    </>
  )
}
