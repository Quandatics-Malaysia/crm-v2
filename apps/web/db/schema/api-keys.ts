import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"
import { organization, user, member } from "./auth"

/**
 * REST API v1 keys. Each key acts as a specific member within one tenant
 * (organization). Only the hash is stored; the plaintext is shown once at
 * creation. `key_prefix` is the non-secret, human-visible label (e.g. the
 * first few chars) used to identify a key in the UI without exposing it.
 *
 * Tenant-scoped: RLS + the SECURITY DEFINER `verify_api_key` lookup live in
 * `db/sql/rls.sql` (applied after the `crm_app` role exists), matching the
 * repo convention that all RLS/grants are hand-authored there, not in the
 * Drizzle migration.
 *
 * `organization` IS the tenant; ids are text (Better Auth), so the tenant FK
 * is text like every other `organization.id` / `member.id` reference.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => member.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
})
