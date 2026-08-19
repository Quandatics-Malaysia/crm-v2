import "server-only"
import { eq, desc, and, isNull, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { operatorAlerts } from "@/db/schema"
import { organization } from "@/db/schema"
import type { ServerContext } from "@/lib/server-context"
import { requireContext } from "@/lib/actions"
export type { AlertSeverity, OperatorAlertRow } from "./operator-alerts-types"
import type { AlertSeverity, OperatorAlertRow } from "./operator-alerts-types"

/**
 * Write a platform-level operator alert. Safe to call from any server context —
 * even when no tenant/user context exists (e.g. an unhandled exception before auth).
 * Errors in this function itself are swallowed so an alert-logging failure never
 * blocks the originating request.  Also emits a structured JSON line to stdout
 * for log-aggregator forwarding (CloudWatch, Datadog, etc.).
 */
export async function writeOperatorAlert(input: {
  severity?: AlertSeverity
  summary: string
  detail?: string
  source?: string
  ctx?: ServerContext | null
  error?: unknown
}): Promise<void> {
  const severity = input.severity ?? "error"
  const source = input.source ?? "server"

  // Extract first line of stack trace for the summary column.
  let stackSummary: string | null = null
  if (input.error instanceof Error) {
    stackSummary = input.error.stack?.split("\n")[0] ?? input.error.message
  }

  const errorDigest =
    input.error && typeof input.error === "object" && "digest" in input.error
      ? String((input.error as { digest?: unknown }).digest ?? null)
      : null

  let tenantId: string | null = null
  let tenantName: string | null = null
  let userId: string | null = null
  let userEmail: string | null = null

  if (input.ctx?.tenantId) {
    tenantId = input.ctx.tenantId
    try {
      const [row] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, tenantId))
        .limit(1)
      tenantName = row?.name ?? null
    } catch {
      // ignore — non-fatal
    }
    userId = input.ctx.userId
    userEmail = input.ctx.userEmail
  }

  const detail = input.detail ?? (
    input.error instanceof Error
      ? input.error.stack ?? input.error.message
      : input.error != null
        ? String(input.error)
        : ""
  )

  // Write to DB — fire-and-forget, never throws so the caller proceeds normally.
  db.insert(operatorAlerts).values({
    severity,
    summary: input.summary,
    detail,
    source,
    tenantId,
    tenantName,
    userId,
    userEmail,
    stackSummary,
    errorDigest,
  }).catch(() => {})

  // Structured stdout line for log-aggregator ingestion.
  console.error(JSON.stringify({
    ALERT: true,
    severity,
    source,
    summary: input.summary,
    tenantId,
    userEmail,
    errorDigest,
    stackSummary,
    detail: detail.slice(0, 500),
  }))
}

/** List operator alerts for the superadmin view. */
export async function listOperatorAlerts(options?: {
  severity?: AlertSeverity | null
  unresolvedOnly?: boolean
  limit?: number
}): Promise<OperatorAlertRow[]> {
  const ctx = await requireContext()
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can view operator alerts.")

  const limit = options?.limit ?? 50
  const unresolvedOnly = options?.unresolvedOnly ?? false
  const severity = options?.severity ?? null

  // Build the where clause step by step.
  const conditions: (SQL<unknown> | undefined)[] = []
  if (unresolvedOnly) {
    conditions.push(isNull(operatorAlerts.resolvedAt))
  }
  if (severity) {
    conditions.push(eq(operatorAlerts.severity, severity))
  }

  const rows = await db
    .select()
    .from(operatorAlerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(operatorAlerts.createdAt))
    .limit(limit)

  return rows as OperatorAlertRow[]
}

/** Mark one or more alerts as resolved. */
export async function resolveOperatorAlerts(
  ids: string[],
  resolvedBy: string,
): Promise<void> {
  const ctx = await requireContext()
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can resolve operator alerts.")

  await db
    .update(operatorAlerts)
    .set({ resolvedAt: new Date(), resolvedBy })
    .where(
      and(
        sql`${operatorAlerts.id} = ANY(${ids})`,
        isNull(operatorAlerts.resolvedAt),
      ),
    )
}

/** Delete old resolved alerts. Called by a scheduled job or on-demand. */
export async function purgeResolvedAlerts(olderThanDays = 90): Promise<number> {
  const ctx = await requireContext()
  if (!ctx.isSuperadmin) throw new Error("Only the platform master can purge operator alerts.")

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)

  const result = await db
    .delete(operatorAlerts)
    .where(
      and(
        sql`${operatorAlerts.createdAt} < ${cutoff}`,
        isNull(operatorAlerts.resolvedAt),
      ),
    )
  // @ts-expect-error drizzle-orm delete result has rowCount on some DB drivers
  return result.rowCount ?? 0
}
