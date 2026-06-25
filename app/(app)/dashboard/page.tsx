import { sql, isNull, and, eq } from "drizzle-orm"
import { requireContext } from "@/lib/server-context"
import { runInTenant } from "@/db"
import {
  leads,
  accounts,
  opportunities,
  quotations,
} from "@/db/schema"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatMoney } from "@/lib/format"

async function getStats(tenantId: string) {
  return runInTenant(tenantId, async (tx) => {
    const count = sql<number>`count(*)::int`
    const [leadRow] = await tx
      .select({ c: count })
      .from(leads)
      .where(isNull(leads.deletedAt))
    const [accountRow] = await tx
      .select({ c: count })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
    const [oppRow] = await tx
      .select({
        c: count,
        weighted: sql<string>`coalesce(sum(${opportunities.amount}), 0)`,
      })
      .from(opportunities)
      .where(and(isNull(opportunities.deletedAt), eq(opportunities.status, "open")))
    const [quoteRow] = await tx
      .select({ c: count })
      .from(quotations)
      .where(isNull(quotations.deletedAt))

    return {
      leads: leadRow?.c ?? 0,
      accounts: accountRow?.c ?? 0,
      openOpportunities: oppRow?.c ?? 0,
      openPipeline: oppRow?.weighted ?? "0",
      quotations: quoteRow?.c ?? 0,
    }
  })
}

export default async function DashboardPage() {
  const ctx = await requireContext()
  const stats = await getStats(ctx.tenantId)

  const cards = [
    { title: "Leads", value: String(stats.leads), desc: "Total leads" },
    { title: "Accounts", value: String(stats.accounts), desc: "Customer accounts" },
    {
      title: "Open Funnels",
      value: String(stats.openOpportunities),
      desc: "Deals in flight",
    },
    {
      title: "Open Pipeline",
      value: formatMoney(stats.openPipeline),
      desc: "Sum of open deal amounts",
    },
  ]

  return (
    <>
      <SiteHeader title="Dashboard" />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.title}>
              <CardHeader>
                <CardDescription>{c.title}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{c.value}</CardTitle>
                <p className="text-xs text-muted-foreground">{c.desc}</p>
              </CardHeader>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Welcome back, {ctx.userName}. You are viewing{" "}
          <span className="font-medium text-foreground">{ctx.roleName ?? "your"}</span>{" "}
          access for this entity.
        </p>
      </PageBody>
    </>
  )
}
