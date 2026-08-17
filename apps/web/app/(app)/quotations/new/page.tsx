import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody, PageHeader } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listOpportunityOptions, getQuotationFormMeta } from "../actions"
import { NewQuotationForm } from "./new-quotation-form"

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ funnelId?: string }>
}) {
  const ctx = await requireContext()
  // No create permission -> there's no affordance to land here; bounce back.
  if (!ctx.can(PERMISSIONS.QUOTATION_CREATE)) redirect("/quotations")
  const sp = await searchParams
  const funnels = await listOpportunityOptions()

  // Prefill from the query when the funnel still exists.
  const defaultOpportunityId = funnels.some((o) => o.id === sp.funnelId)
    ? sp.funnelId
    : undefined
  const meta = await getQuotationFormMeta(defaultOpportunityId)

  return (
    <>
      <SiteHeader title="New quotation" />
      <PageBody>
        <PageHeader title="New quotation" />
        {/* Full-width: the form owns its two-column record layout — a narrow
            card strangles the line-item table. */}
        <NewQuotationForm
          funnels={funnels}
          defaultOpportunityId={defaultOpportunityId}
          taxOptions={meta.taxOptions}
          taxInclusive={meta.taxInclusive}
          projectNatures={meta.projectNatures}
          products={meta.products}
          currencies={meta.currencies}
          defaultValidUntil={meta.defaultValidUntil}
          contacts={meta.contacts}
          defaultAttentionContactId={meta.defaultAttentionContactId}
          quoteDefaults={meta.quoteDefaults}
        />
      </PageBody>
    </>
  )
}
