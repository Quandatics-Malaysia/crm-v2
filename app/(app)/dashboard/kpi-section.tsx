"use client"

import * as React from "react"
import {
  ClipboardCheck,
  CalendarClock,
  TrendingUp,
  Target,
  type LucideIcon,
} from "lucide-react"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { OpenPipeline } from "./actions"

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

function PipelineCards({ scope, p }: { scope: Scope; p: OpenPipeline }) {
  const team = scope === "team"
  return (
    <>
      <KpiCard
        label={team ? "Open Funnel Value" : "My Open Funnel Value"}
        icon={TrendingUp}
        chip="sky"
        value={
          p.mixed ? (
            <span className="text-base font-medium text-muted-foreground">
              Multiple currencies
            </span>
          ) : (
            formatMoney(p.total, p.currency ?? undefined)
          )
        }
        hint={team ? "Sum of all open funnel value" : "Sum of your open funnel value"}
      />
      <KpiCard
        label={team ? "Open Funnels" : "My Open Funnels"}
        icon={Target}
        chip="violet"
        value={p.count}
        hint={team ? "Open pipelines across the team" : "Funnels you own still in flight"}
      />
    </>
  )
}

type Scope = "my" | "team"

/**
 * The four KPI cards. When the user can view all records, the two funnel-rollup
 * cards gain a My/Team toggle (defaulting to Team) so an Owner/Viewer who owns
 * nothing still lands on a useful tenant-wide rollup. The approval card counts
 * what the user can actually action (see {@link DashboardData.canApproveAll}).
 */
export function KpiSection({
  myPipeline,
  orgPipeline,
  approvalsCount,
  canApproveAll,
  followUpsCount,
  hasOverdue,
}: {
  myPipeline: OpenPipeline
  orgPipeline: OpenPipeline | null
  approvalsCount: number
  canApproveAll: boolean
  followUpsCount: number
  hasOverdue: boolean
}) {
  // Default to the tenant-wide view when available, so view-all roles see a
  // populated page on first load even when they personally own nothing.
  const [scope, setScope] = React.useState<Scope>(orgPipeline ? "team" : "my")
  const pipeline = scope === "team" && orgPipeline ? orgPipeline : myPipeline

  return (
    <div className="flex flex-col gap-3">
      {orgPipeline && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={scope === "my" ? "default" : "outline"}
            onClick={() => setScope("my")}
          >
            My work
          </Button>
          <Button
            size="sm"
            variant={scope === "team" ? "default" : "outline"}
            onClick={() => setScope("team")}
          >
            Team
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PipelineCards scope={scope} p={pipeline} />
        <KpiCard
          label={canApproveAll ? "Pending Approvals" : "Approvals Assigned to Me"}
          icon={ClipboardCheck}
          chip={approvalsCount > 0 ? "amber" : "muted"}
          attention={approvalsCount > 0 ? "amber" : undefined}
          value={approvalsCount}
          hint={
            canApproveAll
              ? "Stage requests you can action"
              : "Stage requests routed to you"
          }
        />
        <KpiCard
          label="Follow-ups Due"
          icon={CalendarClock}
          chip={hasOverdue ? "red" : followUpsCount > 0 ? "amber" : "muted"}
          attention={
            hasOverdue ? "red" : followUpsCount > 0 ? "amber" : undefined
          }
          value={followUpsCount}
          hint="Next 7 days assigned to you"
        />
      </div>
    </div>
  )
}
