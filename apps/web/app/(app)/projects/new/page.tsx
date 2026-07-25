import { redirect } from "next/navigation"

// Project creation now happens in a dialog on /projects. Deep links
// (?funnelId=…&accountId=…&quotationId=…) keep working: the params carry over
// and ?new=1 opens the dialog with the same prefill.
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountId?: string
    funnelId?: string
    quotationId?: string
  }>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams({ new: "1" })
  if (sp.accountId) qs.set("accountId", sp.accountId)
  if (sp.funnelId) qs.set("funnelId", sp.funnelId)
  if (sp.quotationId) qs.set("quotationId", sp.quotationId)
  redirect(`/projects?${qs.toString()}`)
}
