import { z } from "zod"
import { verifyEnvelope, type SignedEnvelope, type SigningKey } from "./crypto.js"

/** Literal runtime module IDs from apps/web/modules.config.ts. */
export const ModuleIdSchema = z.enum([
  "projects",
  "salesOrders",
  "finance",
  "forecast",
  "audit",
  "advancedRoles",
  "documentation",
])

const IsoTimestampSchema = z.iso.datetime({ offset: true })

export const EntitlementLeaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    keyId: z.string().min(1),
    leaseId: z.string().min(1),
    clientId: z.string().min(1),
    deploymentId: z.string().min(1),
    issuedAt: IsoTimestampSchema,
    leaseExpiresAt: IsoTimestampSchema,
    contractStartsAt: IsoTimestampSchema,
    contractEndsAt: IsoTimestampSchema,
    graceUntil: IsoTimestampSchema,
    subscriptionStatus: z.enum(["active", "past_due", "suspended", "cancelled"]),
    planId: z.string().min(1),
    maxActiveUsers: z.number().int().min(1).max(100_000),
    moduleIds: z.array(ModuleIdSchema).refine((moduleIds) => new Set(moduleIds).size === moduleIds.length, {
      message: "module IDs must not be duplicated",
    }),
    addonIds: z.array(z.string().min(1)),
    configurationVersion: z.string().min(1),
    releaseChannel: z.enum(["stable", "beta", "canary"]),
    minimumSupportedAppVersion: z.string().min(1),
    approvedImageDigest: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((lease, context) => {
    const issuedAt = Date.parse(lease.issuedAt)
    const leaseExpiresAt = Date.parse(lease.leaseExpiresAt)
    const contractStartsAt = Date.parse(lease.contractStartsAt)
    const contractEndsAt = Date.parse(lease.contractEndsAt)
    const graceUntil = Date.parse(lease.graceUntil)

    if (leaseExpiresAt - issuedAt !== 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: "custom",
        path: ["leaseExpiresAt"],
        message: "leaseExpiresAt must be exactly 24 hours after issuedAt",
      })
    }
    if (graceUntil !== leaseExpiresAt + 7 * 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: "custom",
        path: ["graceUntil"],
        message: "graceUntil must be exactly seven days after leaseExpiresAt",
      })
    }
    if (contractEndsAt < contractStartsAt) {
      context.addIssue({
        code: "custom",
        path: ["contractEndsAt"],
        message: "contractEndsAt must not precede contractStartsAt",
      })
    }
  })

export type EntitlementLease = z.infer<typeof EntitlementLeaseSchema>

/** Verifies signature/scope first, then strictly parses the signed lease. */
export async function verifyEntitlementEnvelope(
  envelope: SignedEnvelope<unknown>,
  publicKeys: Record<string, SigningKey>,
  expectedDeploymentId?: string,
): Promise<EntitlementLease | null> {
  const verified = await verifyEnvelope(envelope, publicKeys, expectedDeploymentId)
  if (verified === null) return null
  const parsed = EntitlementLeaseSchema.safeParse(verified)
  return parsed.success ? parsed.data : null
}

export type LeaseClock = {
  currentTime: Date | string
  greatestTrustedTime?: Date | string
}

export type LeaseAccess = {
  mode: "active" | "grace" | "read_only"
  reason: string
  writeAllowed: boolean
}

/**
 * Evaluates a validated lease using the greatest trusted time supplied by the
 * deployment. This means moving the local clock backwards cannot prolong it.
 */
export function evaluateLease(lease: EntitlementLease, now: Date | string | LeaseClock): LeaseAccess {
  const currentTime = parseTime(typeof now === "object" && !(now instanceof Date) ? now.currentTime : now)
  const greatestTrustedTime =
    typeof now === "object" && !(now instanceof Date) && now.greatestTrustedTime !== undefined
      ? parseTime(now.greatestTrustedTime)
      : currentTime

  if (currentTime === null || greatestTrustedTime === null) {
    return readOnly("Invalid clock input")
  }

  const effectiveTime = Math.max(currentTime, greatestTrustedTime)
  if (lease.subscriptionStatus === "suspended" || lease.subscriptionStatus === "cancelled") {
    return readOnly(`Subscription is ${lease.subscriptionStatus}`)
  }
  if (effectiveTime < Date.parse(lease.contractStartsAt)) {
    return readOnly("Contract has not started")
  }
  if (effectiveTime >= Date.parse(lease.contractEndsAt)) {
    return readOnly("Contract has ended")
  }
  const warning = lease.subscriptionStatus === "past_due" ? "; subscription is past_due" : ""
  if (effectiveTime <= Date.parse(lease.leaseExpiresAt)) {
    return { mode: "active", reason: `Lease is active${warning}`, writeAllowed: true }
  }
  if (effectiveTime <= Date.parse(lease.graceUntil)) {
    return { mode: "grace", reason: `Lease is in offline grace${warning}`, writeAllowed: true }
  }
  return readOnly("Lease grace period has ended")
}

function parseTime(value: Date | string): number | null {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function readOnly(reason: string): LeaseAccess {
  return { mode: "read_only", reason, writeAllowed: false }
}
