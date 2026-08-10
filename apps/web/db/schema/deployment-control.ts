import {
  bigint,
  bigserial,
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const deploymentSubscriptionStatus = pgEnum("deployment_subscription_status", [
  "active",
  "past_due",
  "suspended",
  "cancelled",
])

export const entitlementApplicationOutcome = pgEnum("entitlement_application_outcome", [
  "accepted",
  "rejected",
])

export const deploymentSeatReservationStatus = pgEnum("deployment_seat_reservation_status", [
  "reserved",
  "released",
  "consumed",
  "expired",
])

/** One deployment-scoped, last-known-good signed entitlement. */
export const deploymentControlState = pgTable("deployment_control_state", {
  singleton: smallint("singleton").primaryKey().default(1),
  deploymentId: text("deployment_id").unique(),
  currentRevision: bigint("current_revision", { mode: "number" }).notNull().default(0),
  canonicalEnvelope: text("canonical_envelope"),
  canonicalPayload: text("canonical_payload"),
  envelopeDigest: char("envelope_digest", { length: 64 }),
  keyId: text("key_id"),
  signature: text("signature"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  contractStartsAt: timestamp("contract_starts_at", { withTimezone: true }),
  contractEndsAt: timestamp("contract_ends_at", { withTimezone: true }),
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  subscriptionStatus: deploymentSubscriptionStatus("subscription_status"),
  seatLimit: integer("seat_limit"),
  moduleIds: text("module_ids").array(),
  greatestTrustedAt: timestamp("greatest_trusted_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
})

/** Bounded metadata only; invalid raw envelopes are never retained. */
export const deploymentEntitlementHistory = pgTable(
  "deployment_entitlement_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    outcome: entitlementApplicationOutcome("outcome").notNull(),
    reason: text("reason").notNull(),
    envelopeDigest: char("envelope_digest", { length: 64 }).notNull(),
    revision: bigint("revision", { mode: "number" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("deployment_entitlement_history_received_idx").on(table.receivedAt)],
)

/** One row per invitation; duplicate identities consume one deployment seat. */
export const deploymentSeatReservations = pgTable(
  "deployment_seat_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: text("invitation_id").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    status: deploymentSeatReservationStatus("status").notNull().default("reserved"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("deployment_seat_reservations_invitation_uq").on(table.invitationId),
    index("deployment_seat_reservations_live_identity_idx").on(
      table.status,
      table.expiresAt,
      table.normalizedEmail,
    ),
  ],
)

/** Privileged migrator-published proof of the schema version actually applied. */
export const deploymentRuntimeMetadata = pgTable("deployment_runtime_metadata", {
  singleton: smallint("singleton").primaryKey().default(1),
  migrationVersion: text("migration_version").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
})
