import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { listAccountOptions } from "@/lib/lookups"
import { requireContext } from "@/lib/server-context"
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
  // product type. The value stays EDITABLE.
  let defaultName: string | undefined
  let defaultValue: string | undefined
  let defaultCurrency: string | undefined
  // Product type DERIVED from the source quotation/funnel; from scratch it
  // suggests the tenant's first product type. Editable in the form either way.
  let defaultProductTypeCode: string | undefined = meta.productTypes[0]?.code
  // A bare ?quotationId= (no funnel) still links the source quote on the project.
  let defaultQuotationId: string | undefined = sp.quotationId
  let prefillQuoteNumber: string | undefined
  if (defaultOpportunityId) {
    const prefill = await prefillFromOpportunity(defaultOpportunityId)
    if (prefill) {
      defaultAccountId = prefill.accountId
      defaultName = prefill.opportunityName
      defaultValue = prefill.value
      defaultCurrency = prefill.currency
      defaultProductTypeCode = prefill.productTypeCode || defaultProductTypeCode
      defaultQuotationId = prefill.quotationId ?? defaultQuotationId
      prefillQuoteNumber = prefill.quoteNumber ?? undefined
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
            ? "From the accepted quotation — account, value and product type are prefilled; review and create."
            : "The product type is suggested from your settings and feeds the project code — adjust if needed."}
        </p>
        <ProjectCreateForm
          accounts={accounts}
          opportunities={opportunities}
          productTypes={meta.productTypes}
          entityCode={meta.entityCode}
          codeYear={meta.year}
          accountCodes={meta.accountCodes}
          defaultName={defaultName}
          defaultAccountId={defaultAccountId}
          defaultOpportunityId={defaultOpportunityId}
          defaultProductTypeCode={defaultProductTypeCode}
          defaultValue={defaultValue}
          defaultCurrency={defaultCurrency}
          defaultQuotationId={defaultQuotationId}
          prefillQuoteNumber={prefillQuoteNumber}
        />
      </PageBody>
    </>
  )
}
