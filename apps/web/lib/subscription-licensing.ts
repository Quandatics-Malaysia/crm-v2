import { and, eq, sql } from "drizzle-orm"
import { runInTenant, type Tx } from "@/db"
import { tenantSettings, membershipProfiles } from "@/db/schema"

export type SubscriptionStatus =
  | "active"
  | "trial"
  | "paused"
  | "expired"
  | "cancelled"

export type TenantLicenseState = {
  plan: string
  status: SubscriptionStatus
  seatLimit: number | null
  startsAt: Date | null
  endsAt: Date | null
  activeMemberCount: number
  hasSubscriptionWindow: boolean
  isSubscriptionActive: boolean
}

export function getActiveLicenseState(now: Date, state: TenantLicenseState): boolean {
  if (state.status !== "active" && state.status !== "trial") return false
  if (state.startsAt && state.startsAt > now) return false
  if (state.endsAt && state.endsAt < now) return false
  return true
}

export function canActivateAdditionalMembers(
  state: TenantLicenseState,
  additionalMembers: number,
  now: Date
): boolean {
  if (!getActiveLicenseState(now, state)) return false
  if (state.seatLimit == null) return true
  return state.activeMemberCount + additionalMembers <= state.seatLimit
}

export async function getLicenseStateForTenant(
  tx: Tx,
  tenantId: string,
  now = new Date()
): Promise<TenantLicenseState> {
  const [settings] = await tx
    .select({
      plan: tenantSettings.subscriptionPlan,
      status: tenantSettings.subscriptionStatus,
      seatLimit: tenantSettings.subscriptionSeatLimit,
      startsAt: tenantSettings.subscriptionStartsAt,
      endsAt: tenantSettings.subscriptionEndsAt,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1)

  const [activeMembersRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membershipProfiles)
    .where(
      and(
        eq(membershipProfiles.tenantId, tenantId),
        eq(membershipProfiles.status, "active")
      )
    )

  const state = {
    plan: settings?.plan ?? "Starter",
    status: (settings?.status ?? "active") as SubscriptionStatus,
    seatLimit: settings?.seatLimit ?? null,
    startsAt: settings?.startsAt ?? null,
    endsAt: settings?.endsAt ?? null,
    activeMemberCount: Number(activeMembersRow?.count ?? 0),
    hasSubscriptionWindow:
      settings?.startsAt != null || settings?.endsAt != null,
    isSubscriptionActive: false,
  }

  state.isSubscriptionActive = getActiveLicenseState(now, state)
  return state
}

export async function getLicenseStateWithTenantContext(
  tenantId: string,
  now = new Date()
): Promise<TenantLicenseState> {
  return runInTenant(tenantId, (tx) => getLicenseStateForTenant(tx, tenantId, now))
}

export function formatLicenseWindowLabel(
  startsAt: Date | null,
  endsAt: Date | null
): string {
  const from = startsAt ? startsAt.toISOString().slice(0, 10) : "(not set)"
  const to = endsAt ? endsAt.toISOString().slice(0, 10) : "(not set)"
  return `${from} → ${to}`
}
