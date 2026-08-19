import type { StatusTone } from "./components"
import type { DeploymentWorkspace } from "../repos/onboarding"

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatUtc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "Not available"
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "Not available"
}

export function statusTone(status: string): StatusTone {
  if (["active", "healthy", "online", "registered", "issued", "paid", "used", "success"].includes(status)) return "success"
  if (["grace", "stale", "past_due", "unsigned", "draft", "superseded", "awaiting", "pending"].includes(status)) return "warning"
  if (["disabled", "read_only", "unhealthy", "never_connected", "suspended", "cancelled", "void", "denied", "expired", "error", "failed"].includes(status)) return "error"
  return "neutral"
}

export function licenceLabel(state: DeploymentWorkspace["onboarding"]["licenceState"]): string {
  if (state === "active") return "Active licence"
  if (state === "grace") return "Grace period"
  if (state === "read_only") return "Read-only licence"
  return "Unsigned entitlement"
}

export function connectivityLabel(state: DeploymentWorkspace["onboarding"]["connectivityState"]): string {
  if (state === "online") return "Online"
  if (state === "stale") return "Stale connection"
  return "Never connected"
}