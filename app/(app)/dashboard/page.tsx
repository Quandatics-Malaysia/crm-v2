import Link from "next/link"
import {
  ClipboardCheck,
  CalendarClock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react"
import { isBefore } from "date-fns"

import { requireContext } from "@/lib/server-context"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMoney, formatDate } from "@/lib/format"
import { getDashboardData, type FollowUpDue } from "./actions"

const ENTITY_HREF: Record<string, string> = {
  account: "/accounts",
  person: "/persons",
  lead: "/leads",
  opportunity: "/funnel",
  project: "/projects",
}

function followUpHref(f: FollowUpDue): string {
  const base = ENTITY_HREF[f.entityType] ?? "/dashboard"
  return `${base}/${f.entityId}`
}

const ENTITY_LABEL: Record<string, string> = {
  account: "Account",
  person: "Person",
  lead: "Lead",
  opportunity: "Funnel",
  project: "Project",
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-center">
      <CheckCircle2 className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function RowLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group/row -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
    >
      {children}
      <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
    </Link>
  )
}

export default async function DashboardPage() {
  const ctx = await requireContext()
  const data = await getDashboardData()
  const now = new Date()

  return (
    <>
      <SiteHeader title="Dashboard" />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          Welcome back, {ctx.userName}. Here is what needs your attention.
        </p>

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>My Open Pipeline</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {data.myOpenPipeline.mixed ? (
                  <span className="text-base font-medium text-muted-foreground">
                    Multiple currencies
                  </span>
                ) : (
                  formatMoney(
                    data.myOpenPipeline.total,
                    data.myOpenPipeline.currency ?? undefined
                  )
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sum of your open deal amounts
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>My Open Funnels</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {data.myOpenPipeline.count}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Deals you own still in flight
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Pending My Approval</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {data.myPendingApprovals.length}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Stage requests awaiting you
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Follow-ups Due</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {data.followUpsDue.length}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Next 7 days assigned to you
              </p>
            </CardHeader>
          </Card>
        </div>

        {/* Action lists */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Pending approvals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4" />
                My Pending Approvals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.myPendingApprovals.length === 0 ? (
                <EmptyState>No approvals waiting on you.</EmptyState>
              ) : (
                <div className="flex flex-col divide-y">
                  {data.myPendingApprovals.map((a) => (
                    <RowLink
                      key={a.id}
                      href={`/funnel/${a.opportunityId}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {a.opportunityName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.reason}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(a.requestedAt)}
                      </span>
                    </RowLink>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-ups due */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" />
                Follow-ups Due
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.followUpsDue.length === 0 ? (
                <EmptyState>You are all caught up.</EmptyState>
              ) : (
                <div className="flex flex-col divide-y">
                  {data.followUpsDue.map((f) => {
                    const overdue = isBefore(f.dueAt, now)
                    return (
                      <RowLink key={f.id} href={followUpHref(f)}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {f.subject}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {ENTITY_LABEL[f.entityType] ?? f.entityType}
                          </p>
                        </div>
                        <Badge
                          variant={overdue ? "destructive" : "secondary"}
                          className="shrink-0"
                        >
                          {overdue ? "Overdue " : ""}
                          {formatDate(f.dueAt)}
                        </Badge>
                      </RowLink>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
