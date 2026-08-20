"use server"

import { writeOperatorAlert } from "@/server/services/operator-alerts"
import { getServerContext } from "@/lib/server-context"
import type { AlertSeverity, OperatorAlertRow } from "@/server/services/operator-alerts-types"
import { listOperatorAlerts as listAlerts, resolveOperatorAlerts as resolveAlerts } from "@/server/services/operator-alerts"

// ─── reportIncident ───────────────────────────────────────────────────────────

type IncidentInput = {
  severity?: AlertSeverity
  summary: string
  detail?: string
  source?: string
  errorMessage?: string
  errorDigest?: string
}

/**
 * Server action that reports an incident to the operator alert log.
 * Designed to be called from the React error boundary — it NEVER throws so
 * the boundary's render is never itself broken by a reporting failure.
 */
export async function reportIncident(input: IncidentInput): Promise<void> {
  let ctx = null
  try {
    ctx = await getServerContext()
  } catch {
    // Context resolution can fail when auth is partially broken.
  }

  try {
    const error = input.errorMessage != null
      ? Object.assign(new Error(input.errorMessage), { digest: input.errorDigest })
      : undefined
    await writeOperatorAlert({
      severity: input.severity,
      summary: input.summary,
      detail: input.detail,
      source: input.source ?? "app_error_boundary",
      ctx: ctx ?? null,
      error,
    })
  } catch {
    // writeOperatorAlert already fire-and-forgets DB writes.
  }
}

// ─── Operator alerts read/list ───────────────────────────────────────────────

export async function listOperatorAlerts(options?: {
  severity?: AlertSeverity | null
  unresolvedOnly?: boolean
  limit?: number
}): Promise<OperatorAlertRow[]> {
  return listAlerts(options)
}

// ─── Resolve ────────────────────────────────────────────────────────────────

export async function resolveOperatorAlerts(ids: string[], resolvedBy: string): Promise<void> {
  return resolveAlerts(ids, resolvedBy)
}
