import { StatusBadge } from "@/components/status-badge"
import type { SalesOrderRow } from "./actions"

/**
 * Single source of truth for the sales-order status pill, shared by the global
 * table and the project panel so the same status never drifts in shade. Built
 * on the app-wide StatusBadge tone map: approved → emerald success, rejected →
 * danger, submitted → warning ("Pending review").
 */
export function SalesOrderStatusBadge({
  status,
}: {
  status: SalesOrderRow["status"]
}) {
  if (status === "submitted") {
    return <StatusBadge status="submitted" tone="warning" label="Pending review" />
  }
  return <StatusBadge status={status} />
}
