import { notFound, redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { requireContext } from "@/lib/server-context"
import { PERMISSIONS } from "@/lib/permissions"
import { listAccountOptions, listCountries } from "@/lib/lookups"
import { getLead } from "../../actions"
import { ConvertForm } from "./convert-form"

export default async function ConvertLeadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [ctx, data, accountOptions, countries] = await Promise.all([
    requireContext(),
    getLead(id),
    listAccountOptions(),
    listCountries(),
  ])
  // No convert permission → no affordance leads here; bounce back.
  if (!ctx.can(PERMISSIONS.LEAD_CONVERT)) redirect("/leads")
  if (!data) notFound()
  // Conversion is one-way — a converted lead has nothing left to convert.
  if (data.lead.status === "converted") redirect(`/leads/${id}`)

  return (
    <>
      <SiteHeader
        title="Convert lead"
        breadcrumbs={[
          { label: "Leads", href: "/leads" },
          { label: data.lead.name, href: `/leads/${id}` },
          { label: "Convert" },
        ]}
      />
      <PageBody>
        <ConvertForm
          lead={data.lead}
          accountOptions={accountOptions}
          countries={countries}
        />
      </PageBody>
    </>
  )
}
