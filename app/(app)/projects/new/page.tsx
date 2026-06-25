import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { listAccountOptions } from "@/lib/lookups"
import { listOpportunityOptions, prefillFromOpportunity } from "../actions"
import { ProjectCreateForm } from "../project-create-form"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; opportunityId?: string }>
}) {
  const sp = await searchParams
  const [accounts, opportunities] = await Promise.all([
    listAccountOptions(),
    listOpportunityOptions(),
  ])

  // Prefill from query: explicit opportunity wins and derives its account.
  let defaultAccountId = sp.accountId
  const defaultOpportunityId = sp.opportunityId

  // When created from a funnel, pre-fill value + linked quotation from the
  // opportunity's source quote (net of tax). The value stays EDITABLE.
  let defaultValue: string | undefined
  let defaultQuotationId: string | undefined
  let prefillQuoteNumber: string | undefined
  if (defaultOpportunityId) {
    const prefill = await prefillFromOpportunity(defaultOpportunityId)
    if (prefill) {
      defaultAccountId = prefill.accountId
      defaultValue = prefill.value
      defaultQuotationId = prefill.quotationId ?? undefined
      prefillQuoteNumber = prefill.quoteNumber ?? undefined
    } else {
      // Fall back to deriving the account from the funnel options.
      const opp = opportunities.find((o) => o.id === defaultOpportunityId)
      if (opp) defaultAccountId = opp.accountId
    }
  }

  return (
    <>
      <SiteHeader title="New project" />
      <PageBody>
        <PageHeader title="New project" />
        <ProjectCreateForm
          accounts={accounts}
          opportunities={opportunities}
          defaultAccountId={defaultAccountId}
          defaultOpportunityId={defaultOpportunityId}
          defaultValue={defaultValue}
          defaultQuotationId={defaultQuotationId}
          prefillQuoteNumber={prefillQuoteNumber}
        />
      </PageBody>
    </>
  )
}
