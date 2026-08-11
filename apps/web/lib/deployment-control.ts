import "server-only"

import {
  EntitlementLeaseSchema,
  canonicalJson,
  evaluateLease,
  verifyEnvelope,
  type EntitlementLease,
  type SignedEnvelope,
} from "@crm/control-protocol"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { env } from "@/lib/env"
import { isDependencyClosed } from "@/lib/module-registry"

const MAX_CANONICAL_ENVELOPE_BYTES = 131_072
const isoTimestamp = z.iso.datetime({ offset: true })

const publicEd25519JwkSchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    alg: z.enum(["EdDSA", "Ed25519"]).optional(),
    ext: z.boolean().optional(),
    key_ops: z.array(z.literal("verify")).max(1).optional(),
  })
  .strict()

const trustSetSchema = z
  .object({
    version: z.literal(1),
    keys: z.array(z.object({
      keyId: z.string().min(1).max(128),
      publicJwk: publicEd25519JwkSchema,
      validFrom: isoTimestamp,
      validUntil: isoTimestamp,
    }).strict()).min(1),
  })
  .strict()
  .superRefine((trustSet, context) => {
    const ids = new Set<string>()
    trustSet.keys.forEach((key, index) => {
      if (ids.has(key.keyId)) {
        context.addIssue({ code: "custom", path: ["keys", index, "keyId"], message: "duplicate key ID" })
      }
      ids.add(key.keyId)
      if (Date.parse(key.validUntil) <= Date.parse(key.validFrom)) {
        context.addIssue({ code: "custom", path: ["keys", index, "validUntil"], message: "invalid trust window" })
      }
    })
  })

const signedEnvelopeSchema = z.object({
  keyId: z.string().min(1).max(128),
  payload: z.unknown(),
  signature: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export type VendorEntitlementTrustSet = {
  version: 1
  keys: Array<{
    keyId: string
    publicJwk: JsonWebKey
    validFrom: string
    validUntil: string
  }>
}

export type DeploymentControlHistoryEntry = {
  outcome: "accepted" | "rejected"
  reason: string
  digest: string
  revision: number | null
}

export type DeploymentEntitlementState = {
  deploymentId: string
  revision: number
  canonicalEnvelope: string
  canonicalPayload: string
  envelope: SignedEnvelope<EntitlementLease>
  keyId: string
  issuedAt: Date
  leaseExpiresAt: Date
  contractStartsAt: Date
  contractEndsAt: Date
  graceUntil: Date
  subscriptionStatus: EntitlementLease["subscriptionStatus"]
  seatLimit: number
  moduleIds: EntitlementLease["moduleIds"]
  greatestTrustedAt: Date
}

export type VerifiedEntitlementApplication = {
  deploymentId: string
  revision: number
  envelope: SignedEnvelope<EntitlementLease>
  lease: EntitlementLease
  canonicalEnvelope: string
  canonicalPayload: string
  digest: string
  receivedAt: Date
}

export type EntitlementApplicationResult = {
  outcome: "accepted" | "idempotent" | "rejected"
  reason: string
  revision: number | null
}

export type DeploymentAccess = {
  mode: "active" | "grace" | "read_only"
  reason: string
  writeAllowed: boolean
  seatLimit: number
  moduleIds: EntitlementLease["moduleIds"]
  leaseExpiresAt: string | null
  graceUntil: string | null
  contractStartsAt: string | null
  contractEndsAt: string | null
  revision: number | null
  configurationVersion: string | null
  subscriptionStatus: EntitlementLease["subscriptionStatus"] | null
  planId: string | null
}

export interface DeploymentControlPersistence {
  applyVerified(input: VerifiedEntitlementApplication): Promise<EntitlementApplicationResult>
  recordRejected(entry: DeploymentControlHistoryEntry): Promise<void>
  getState(observedAt?: Date): Promise<DeploymentEntitlementState | null>
}

function modulesAreValid(moduleIds: EntitlementLease["moduleIds"]): boolean {
  return isDependencyClosed(moduleIds)
}

async function sha256Hex(value: unknown): Promise<string> {
  let encoded: string
  try {
    encoded = canonicalJson(value)
  } catch {
    try {
      encoded = JSON.stringify(value) ?? "unserializable"
    } catch {
      encoded = "unserializable"
    }
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function parseTrustSet(value: unknown): VendorEntitlementTrustSet {
  return trustSetSchema.parse(value) as VendorEntitlementTrustSet
}

async function reject(
  persistence: DeploymentControlPersistence,
  reason: string,
  digest: string,
  revision: number | null,
): Promise<EntitlementApplicationResult> {
  await persistence.recordRejected({ outcome: "rejected", reason, digest, revision })
  const current = await persistence.getState().catch(() => null)
  return { outcome: "rejected", reason, revision: current?.revision ?? null }
}

export function createDeploymentControlService(input: {
  persistence: DeploymentControlPersistence
  trustSet: VendorEntitlementTrustSet
  now?: () => Date
}) {
  const trustSet = parseTrustSet(input.trustSet)

  return {
    async applySignedEntitlement(
      candidate: unknown,
      expectedDeploymentId: string,
    ): Promise<EntitlementApplicationResult> {
      const receivedAt = input.now?.() ?? new Date()
      const digest = await sha256Hex(candidate)
      const envelopeResult = signedEnvelopeSchema.safeParse(candidate)
      if (!envelopeResult.success || expectedDeploymentId.length === 0 || expectedDeploymentId.length > 256) {
        return reject(input.persistence, "malformed_envelope", digest, null)
      }

      const envelope = envelopeResult.data as SignedEnvelope<unknown>
      const trustKey = trustSet.keys.find((key) => key.keyId === envelope.keyId)
      if (!trustKey) return reject(input.persistence, "unknown_key", digest, null)

      const verified = await verifyEnvelope(envelope, { [trustKey.keyId]: trustKey.publicJwk })
      if (verified === null) return reject(input.persistence, "invalid_signature", digest, null)

      const leaseResult = EntitlementLeaseSchema.safeParse(verified)
      if (!leaseResult.success) return reject(input.persistence, "invalid_payload", digest, null)
      const lease = leaseResult.data
      if (lease.deploymentId !== expectedDeploymentId) {
        return reject(input.persistence, "deployment_mismatch", digest, lease.revision)
      }

      const signedAt = Date.parse(lease.issuedAt)
      const receivedTime = receivedAt.getTime()
      if (
        signedAt < Date.parse(trustKey.validFrom) || signedAt >= Date.parse(trustKey.validUntil) ||
        receivedTime < Date.parse(trustKey.validFrom) || receivedTime >= Date.parse(trustKey.validUntil)
      ) {
        return reject(input.persistence, "trust_key_not_valid", digest, lease.revision)
      }
      if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > Date.parse(lease.graceUntil)) {
        return reject(input.persistence, "expired_lease", digest, lease.revision)
      }
      if (!modulesAreValid(lease.moduleIds)) {
        return reject(input.persistence, "invalid_modules", digest, lease.revision)
      }

      const canonicalPayload = canonicalJson(lease)
      if (canonicalPayload !== canonicalJson(envelope.payload)) {
        return reject(input.persistence, "noncanonical_payload", digest, lease.revision)
      }
      const acceptedEnvelope: SignedEnvelope<EntitlementLease> = {
        keyId: envelope.keyId,
        payload: lease,
        signature: envelope.signature,
      }
      const canonicalEnvelope = canonicalJson(acceptedEnvelope)
      if (new TextEncoder().encode(canonicalEnvelope).byteLength > MAX_CANONICAL_ENVELOPE_BYTES) {
        return reject(input.persistence, "envelope_too_large", digest, lease.revision)
      }

      return input.persistence.applyVerified({
        deploymentId: expectedDeploymentId,
        revision: lease.revision,
        envelope: acceptedEnvelope,
        lease,
        canonicalEnvelope,
        canonicalPayload,
        digest,
        receivedAt,
      })
    },

    getDeploymentAccess(now: Date): Promise<DeploymentAccess> {
      return getAccess(input.persistence, now)
    },
  }
}

function unavailable(reason: string): DeploymentAccess {
  return {
    mode: "read_only",
    reason,
    writeAllowed: false,
    seatLimit: 0,
    moduleIds: [],
    leaseExpiresAt: null,
    graceUntil: null,
    contractStartsAt: null,
    contractEndsAt: null,
    revision: null,
    configurationVersion: null,
    subscriptionStatus: null,
    planId: null,
  }
}

async function readAccess(persistence: DeploymentControlPersistence, now: Date): Promise<DeploymentAccess> {
  const state = await persistence.getState(now)
  if (!state) return unavailable("No valid entitlement bundle is available")

  const access = evaluateLease(state.envelope.payload, {
    currentTime: now,
    greatestTrustedTime: state.greatestTrustedAt,
  })
  return {
    ...access,
    seatLimit: state.seatLimit,
    moduleIds: [...state.moduleIds],
    leaseExpiresAt: state.leaseExpiresAt.toISOString(),
    graceUntil: state.graceUntil.toISOString(),
    contractStartsAt: state.contractStartsAt.toISOString(),
    contractEndsAt: state.contractEndsAt.toISOString(),
    revision: state.revision,
    configurationVersion: state.envelope.payload.configurationVersion,
    subscriptionStatus: state.subscriptionStatus,
    planId: state.envelope.payload.planId,
  }
}

async function getAccess(persistence: DeploymentControlPersistence, now: Date): Promise<DeploymentAccess> {
  try {
    return await readAccess(persistence, now)
  } catch {
    return unavailable("Entitlement state is unavailable")
  }
}

type ApplyRow = { outcome: string; reason: string; current_revision: number | string | null }
type StateRow = {
  deployment_id: string
  current_revision: number | string
  canonical_envelope: string
  canonical_payload: string
  key_id: string
  issued_at: Date | string
  lease_expires_at: Date | string
  contract_starts_at: Date | string
  contract_ends_at: Date | string
  grace_until: Date | string
  subscription_status: EntitlementLease["subscriptionStatus"]
  seat_limit: number
  module_ids: EntitlementLease["moduleIds"]
  greatest_trusted_at: Date | string
}

export function createPostgresDeploymentControlPersistence(
  database: typeof db,
): DeploymentControlPersistence {
  return {
  async applyVerified(input) {
    const lease = input.lease
    const moduleIds = `{${lease.moduleIds.join(",")}}`
    const rows = await database.execute(sql`
      select * from apply_verified_deployment_entitlement(
        ${input.deploymentId}, ${lease.deploymentId}, ${input.revision},
        ${input.canonicalEnvelope}, ${input.canonicalPayload}, ${input.digest},
        ${lease.keyId}, ${input.envelope.signature}, ${lease.issuedAt},
        ${lease.leaseExpiresAt}, ${lease.contractStartsAt},
        ${lease.contractEndsAt}, ${lease.graceUntil},
        ${lease.subscriptionStatus}::deployment_subscription_status,
        ${lease.maxActiveUsers}, ${moduleIds}::text[], ${input.receivedAt.toISOString()}
      )
    `) as unknown as ApplyRow[]
    const row = rows[0]
    if (!row || !["accepted", "idempotent", "rejected"].includes(row.outcome)) {
      throw new Error("Deployment entitlement apply returned an invalid result")
    }
    return {
      outcome: row.outcome as EntitlementApplicationResult["outcome"],
      reason: row.reason,
      revision: row.current_revision === null ? null : Number(row.current_revision),
    }
  },

  async recordRejected(entry) {
    await database.execute(sql`
      select record_deployment_entitlement_rejection(
        ${entry.reason}, ${entry.digest}, ${entry.revision}, ${new Date().toISOString()}
      )
    `)
  },

  async getState(observedAt) {
    const rows = await database.execute(sql`
      select * from read_deployment_entitlement_state(${observedAt?.toISOString() ?? null}::timestamp with time zone)
    `) as unknown as StateRow[]
    const row = rows[0]
    if (!row) return null

    const rawEnvelope: unknown = JSON.parse(row.canonical_envelope)
    const envelopeResult = signedEnvelopeSchema.safeParse(rawEnvelope)
    if (!envelopeResult.success) throw new Error("Stored entitlement envelope is invalid")
    const lease = EntitlementLeaseSchema.parse(envelopeResult.data.payload)
    const envelope: SignedEnvelope<EntitlementLease> = {
      keyId: envelopeResult.data.keyId,
      payload: lease,
      signature: envelopeResult.data.signature,
    }
    if (
      envelope.keyId !== lease.keyId ||
      canonicalJson(envelope) !== row.canonical_envelope ||
      canonicalJson(lease) !== row.canonical_payload ||
      lease.revision !== Number(row.current_revision)
    ) {
      throw new Error("Stored entitlement state is inconsistent")
    }

    return {
      deploymentId: row.deployment_id,
      revision: Number(row.current_revision),
      canonicalEnvelope: row.canonical_envelope,
      canonicalPayload: row.canonical_payload,
      envelope,
      keyId: row.key_id,
      issuedAt: new Date(row.issued_at),
      leaseExpiresAt: new Date(row.lease_expires_at),
      contractStartsAt: new Date(row.contract_starts_at),
      contractEndsAt: new Date(row.contract_ends_at),
      graceUntil: new Date(row.grace_until),
      subscriptionStatus: row.subscription_status,
      seatLimit: row.seat_limit,
      moduleIds: row.module_ids,
      greatestTrustedAt: new Date(row.greatest_trusted_at),
    }
  },
  }
}

const postgresPersistence = createPostgresDeploymentControlPersistence(db)

export async function applySignedEntitlement(
  envelope: unknown,
  expectedDeploymentId: string,
): Promise<EntitlementApplicationResult> {
  let parsedTrustSet: VendorEntitlementTrustSet
  try {
    parsedTrustSet = parseTrustSet(JSON.parse(env.VENDOR_ENTITLEMENT_TRUST_SET))
  } catch {
    return reject(postgresPersistence, "trust_set_invalid", await sha256Hex(envelope), null)
  }
  return createDeploymentControlService({ persistence: postgresPersistence, trustSet: parsedTrustSet })
    .applySignedEntitlement(envelope, expectedDeploymentId)
}

export function getDeploymentAccess(now = new Date()): Promise<DeploymentAccess> {
  return getAccess(postgresPersistence, now)
}

/** Status reporting must distinguish an absent lease from an unavailable database. */
export function getDeploymentAccessForStatus(now = new Date()): Promise<DeploymentAccess> {
  return readAccess(postgresPersistence, now)
}
