import Link from "next/link"
import {
  ClipboardCheck,
  CalendarClock,
  ArrowRight,
  Inbox,
  UserPlus,
  Building2,
  HourglassIcon,
  ReceiptTextIcon,
} from "lucide-react"
import { isBefore } from "date-fns"

import { requireContext } from "@/lib/server-context"
import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format"
import { getDashboardData, type FollowUpDue } from "./actions"
import { GettingStarted, type ChecklistItem } from "./getting-started"
import { KpiSection } from "./kpi-section"

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

function FirstRunHero({ name }: { name: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="font-heading text-xl">
          Welcome, {name}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Your workspace is ready. Add your first records to bring it to life —
          your funnel and SST tax are already set up.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <Button nativeButton={false} render={<Link href="/leads?new=1" />}>
          <UserPlus />
          Add your first lead
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/accounts?new=1" />}
        >
          <Building2 />
          Add an account or contact
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/team" />}
        >
          <UserPlus />
          Invite your team
        </Button>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const ctx = await requireContext()
  const data = await getDashboardData()
  const now = new Date()

  const approvalsCount = data.pendingApprovals.length
  const followUpsCount = data.followUpsDue.length
  const hasOverdue = data.followUpsDue.some((f) => isBefore(f.dueAt, now))
  const approvalsTitle = data.canApproveAll
    ? "Pending Approvals"
    : "Approvals Assigned to Me"

  const checklist: ChecklistItem[] = [
    {
      key: "lead",
      label: "Add your first lead",
      description: "Capture inbound interest to start your funnel.",
      href: "/leads?new=1",
      done: data.gettingStarted.hasLead,
    },
    {
      key: "account",
      label: "Add an account or contact",
      description: "Record the company and people you sell to.",
      href: "/accounts?new=1",
      done: data.gettingStarted.hasAccountOrContact,
    },
    {
      key: "stages",
      label: "Review your funnel stages",
      description: "Default stages are ready — tune them in Settings.",
      href: "/settings",
      done: data.gettingStarted.hasStages,
    },
    {
      key: "tax",
      label: "Set your currency & SST tax",
      description: "MYR and SST 6% are pre-configured.",
      href: "/settings",
      done: data.gettingStarted.hasCurrencyTax,
    },
    {
      key: "team",
      label: "Invite a teammate",
      description: "Bring your team into the workspace.",
      href: "/team",
      done: data.gettingStarted.hasTeammate,
    },
  ]

  return (
    <>
      <SiteHeader title="Dashboard" />
      <PageBody>
        {data.isFirstRun ? (
          <>
            <FirstRunHero name={ctx.userName} />
            <GettingStarted items={checklist} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Welcome back, {ctx.userName}. Here is what needs your attention.
            </p>

            <GettingStarted items={checklist} />

            {/* KPI row (My/Team toggle on the funnel rollup for view-all roles) */}
            <KpiSection
              myPipeline={data.myOpenPipeline}
              orgPipeline={data.orgOpenPipeline}
              approvalsCount={approvalsCount}
              canApproveAll={data.canApproveAll}
              followUpsCount={followUpsCount}
              hasOverdue={hasOverdue}
            />

            {/* Action lists */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Pending approvals */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="size-4" />
                    {approvalsTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {approvalsCount === 0 ? (
                    <EmptyState
                      icon={Inbox}
                      title="No approvals waiting on you"
                      description="Stage requests that need your decision will appear here."
                    />
                  ) : (
                    <div className="flex flex-col divide-y">
                      {data.pendingApprovals.map((a) => (
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
                  {followUpsCount === 0 ? (
                    <EmptyState
                      icon={CalendarClock}
                      title="You are all caught up"
                      description="Follow-ups due in the next 7 days will show up here."
                    />
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

              {/* Overdue invoices — finance add-on */}
              {data.overdueInvoices.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ReceiptTextIcon className="size-4" />
                      Overdue Invoices
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col divide-y">
                      {data.overdueInvoices.map((inv) => {
                        const stageDue = data.reminderSchedule.filter(
                          (d) =>
                            (now.getTime() - new Date(inv.dueDate).getTime()) /
                              86_400_000 >=
                            d
                        ).length
                        const reminderPending = stageDue > inv.reminderStage
                        return (
                          <RowLink key={inv.id} href={`/billing/${inv.id}`}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {inv.number}
                                {inv.partyName ? ` · ${inv.partyName}` : ""}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                Due {formatDate(inv.dueDate)}
                              </p>
                            </div>
                            <Badge
                              variant={reminderPending ? "destructive" : "secondary"}
                              className="shrink-0"
                            >
                              {reminderPending
                                ? `Reminder ${inv.reminderStage + 1} due`
                                : `${inv.reminderStage} reminder${inv.reminderStage === 1 ? "" : "s"} sent`}
                            </Badge>
                          </RowLink>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Stale funnels — only rendered when the nudge is configured */}
              {data.staleDealDays != null ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HourglassIcon className="size-4" />
                      Stale Funnels
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.staleDeals.length === 0 ? (
                      <EmptyState
                        icon={HourglassIcon}
                        title="Nothing going cold"
                        description={`Your open funnels with no activity for ${data.staleDealDays} days will show here.`}
                      />
                    ) : (
                      <div className="flex flex-col divide-y">
                        {data.staleDeals.map((d) => (
                          <RowLink key={d.id} href={`/funnel/${d.id}`}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {d.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                Last touched {formatDate(d.lastTouchAt)}
                              </p>
                            </div>
                            <Badge variant="secondary" className="shrink-0">
                              {Math.floor(
                                (now.getTime() - d.lastTouchAt.getTime()) /
                                  86_400_000
                              )}
                              d idle
                            </Badge>
                          </RowLink>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}
