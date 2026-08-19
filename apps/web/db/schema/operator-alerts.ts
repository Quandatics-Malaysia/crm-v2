import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core"

/**
 * Platform-level operator alerts — NOT scoped to any tenant. Written by server-side
 * error handlers and the deployment control layer when unexpected conditions arise.
 * Queryable by the superadmin via the Manage Organizations dialog and the vendor's
 * internal tooling via the REST API.
 */
export const operatorAlerts = pgTable("operator_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Severity level drives the UI badge colour and vendor alert routing. */
  severity: text("severity", { enum: ["info", "warning", "error", "critical"] }).notNull().default("error"),
  /** Human-readable summary shown in the alerts list and email digests. */
  summary: text("summary").notNull(),
  /** Full stack trace or structured error context for post-incident analysis. */
  detail: text("detail").notNull().default(""),
  /** Which part of the stack generated this alert. */
  source: text("source").notNull().default("server"),
  /** tenantId is null when the error occurred before tenant resolution. */
  tenantId: text("tenant_id"),
  tenantName: text("tenant_name"),
  /** User that triggered the action, if any. */
  userId: text("user_id"),
  userEmail: text("user_email"),
  /** For errors with a stack trace: the first line of the stack. */
  stackSummary: text("stack_summary"),
  /** Next.js/React error digest, when available. */
  errorDigest: text("error_digest"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("operator_alerts_severity_idx").on(t.severity),
  index("operator_alerts_created_idx").on(t.createdAt),
  index("operator_alerts_tenant_idx").on(t.tenantId),
])

export type OperatorAlert = typeof operatorAlerts.$inferSelect
