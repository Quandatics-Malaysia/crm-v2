// Shared types for operator alerts — safe to import from both client and server.

export type AlertSeverity = "info" | "warning" | "error" | "critical"

export type OperatorAlertRow = {
  id: string
  severity: AlertSeverity
  summary: string
  detail: string
  source: string
  tenantId: string | null
  tenantName: string | null
  userId: string | null
  userEmail: string | null
  stackSummary: string | null
  errorDigest: string | null
  resolvedAt: Date | null
  resolvedBy: string | null
  createdAt: Date
}
