import Link from "next/link"
import {
  ClipboardCheck,
  CalendarClock,
  ArrowRight,
  Inbox,
  TrendingUp,
  Target,
  UserPlus,
  Building2,
  type LucideIcon,
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
import { formatMoney, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getDashboardData, type FollowUpDue } from "./actions"
import { GettingStarted, type ChecklistItem } from "./getting-started"

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

/** Tinted icon-chip palettes for the KPI cards. */
const CHIP: Record<"sky" | "violet" | "amber" | "red" | "muted", string> = {
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  chip,
  attention,
}: {
  label: string
  value: React.ReactNode
  hint: string
  icon: LucideIcon
  chip: keyof typeof CHIP
  /** Accent ring when the metric needs action. */
  attention?: "amber" | "red"
}) {
  return (
    <Card
      className={cn(
        attention === "amber" && "ring-1 ring-amber-500/40",
        attention === "red" && "ring-1 ring-red-500/40"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              CHIP[chip]
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
    </Card>
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

  const approvalsCount = data.myPendingApprovals.length
  const followUpsCount = data.followUpsDue.length
  const hasOverdue = data.followUpsDue.some((f) => isBefore(f.dueAt, now))

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

            {/* KPI row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="My Open Funnel Value"
                icon={TrendingUp}
                chip="sky"
                value={
                  data.myOpenPipeline.mixed ? (
                    <span className="text-base font-medium text-muted-foreground">
                      Multiple currencies
                    </span>
                  ) : (
                    formatMoney(
                      data.myOpenPipeline.total,
                      data.myOpenPipeline.currency ?? undefined
                    )
                  )
                }
                hint="Sum of your open funnel value"
              />
              <KpiCard
                label="My Open Funnels"
                icon={Target}
                chip="violet"
                value={data.myOpenPipeline.count}
                hint="Funnels you own still in flight"
              />
              <KpiCard
                label="Pending My Approval"
                icon={ClipboardCheck}
                chip={approvalsCount > 0 ? "amber" : "muted"}
                attention={approvalsCount > 0 ? "amber" : undefined}
                value={approvalsCount}
                hint="Stage requests awaiting you"
              />
              <KpiCard
                label="Follow-ups Due"
                icon={CalendarClock}
                chip={
                  hasOverdue ? "red" : followUpsCount > 0 ? "amber" : "muted"
                }
                attention={
                  hasOverdue ? "red" : followUpsCount > 0 ? "amber" : undefined
                }
                value={followUpsCount}
                hint="Next 7 days assigned to you"
              />
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
                  {approvalsCount === 0 ? (
                    <EmptyState
                      icon={Inbox}
                      title="No approvals waiting on you"
                      description="Stage requests that need your decision will appear here."
                    />
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
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}
