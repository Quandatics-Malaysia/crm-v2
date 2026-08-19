"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react"

import {
  listOperatorAlerts,
  resolveOperatorAlerts,
} from "@/app/(app)/_shared/operator-alert-actions"
import type { OperatorAlertRow } from "@/server/services/operator-alerts-types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type Severity = "info" | "warning" | "error" | "critical"

const SEVERITY_META: Record<Severity, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  info:     { icon: InfoIcon,        color: "text-blue-500",    label: "Info" },
  warning:  { icon: AlertTriangleIcon, color: "text-amber-500",   label: "Warning" },
  error:    { icon: AlertCircleIcon,  color: "text-red-500",    label: "Error" },
  critical: { icon: ShieldAlertIcon,  color: "text-red-700",    label: "Critical" },
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { icon: Icon, color, label } = SEVERITY_META[severity] ?? SEVERITY_META.error
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}

function AlertRow({
  alert,
  onResolve,
}: {
  alert: OperatorAlertRow
  onResolve: (id: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const resolved = alert.resolvedAt != null

  return (
    <div className={`rounded-lg border px-3 py-2 ${resolved ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <SeverityBadge severity={alert.severity} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{alert.summary}</p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(alert.createdAt).toLocaleString()}
            </span>
          </div>
          {alert.tenantName ? (
            <p className="text-xs text-muted-foreground">
              {alert.tenantName}
              {alert.userEmail ? ` · ${alert.userEmail}` : ""}
            </p>
          ) : alert.userEmail ? (
            <p className="text-xs text-muted-foreground">{alert.userEmail}</p>
          ) : null}
          {resolved && alert.resolvedBy ? (
            <p className="mt-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2Icon className="mr-1 inline size-3" />
              Resolved by {alert.resolvedBy}
            </p>
          ) : null}
        </div>
      </div>

      {alert.detail ? (
        <>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
            {expanded ? "Hide detail" : "Show detail"}
          </button>
          {expanded && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap break-all">
              {alert.detail}
            </pre>
          )}
        </>
      ) : null}

      {!resolved && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onResolve(alert.id)}
          >
            Mark resolved
          </button>
        </div>
      )}
    </div>
  )
}

export function OperatorAlertsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [alerts, setAlerts] = React.useState<OperatorAlertRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [filter, setFilter] = React.useState<Severity | "all">("all")
  const [unresolvedOnly, setUnresolvedOnly] = React.useState(false)

  async function load() {
    setLoading(true)
    try {
      const opts = {
        ...(filter !== "all" ? { severity: filter } : {}),
        ...(unresolvedOnly ? { unresolvedOnly: true } : {}),
        limit: 100,
      }
      const data = await listOperatorAlerts(opts as Parameters<typeof listOperatorAlerts>[0])
      setAlerts(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load alerts")
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- intentionally calling load() when dialog opens; load() sets loading state
  React.useEffect(() => { if (open) load() }, [open])

  async function handleResolve(id: string) {
    try {
      await resolveOperatorAlerts([id], "operator")
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, resolvedAt: new Date(), resolvedBy: "operator" } : a
        )
      )
      toast.success("Alert resolved")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve alert")
    }
  }

  const unresolvedCount = alerts.filter((a) => !a.resolvedAt).length
  const displayed = filter === "all" ? alerts : alerts.filter((a) => a.severity === filter)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Operator alerts</DialogTitle>
              <DialogDescription>
                Platform incidents and unexpected errors.
                {unresolvedCount > 0 ? ` ${unresolvedCount} unresolved.` : " All resolved."}
              </DialogDescription>
            </div>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={load}
              title="Refresh"
            >
              <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </DialogHeader>

        {/* Severity filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "critical", "error", "warning", "info"] as const).map((sev) => (
            <button
              key={sev}
              type="button"
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                filter === sev
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              onClick={() => setFilter(sev)}
            >
              {sev === "all" ? "All" : SEVERITY_META[sev].label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={unresolvedOnly}
              onChange={(e) => setUnresolvedOnly(e.target.checked)}
              className="rounded"
            />
            Unresolved only
          </label>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No alerts matching the current filter.
          </div>
        ) : (
          <div className="grid gap-2">
            {displayed.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onResolve={handleResolve} />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
