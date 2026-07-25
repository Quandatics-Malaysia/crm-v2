import { pgTable, pgEnum, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { timestamps } from "./_helpers"

export const activityEntityType = pgEnum("activity_entity_type", [
  "account",
  "person",
  "lead",
  "opportunity",
  "project",
  "finance_doc",
])

export const activityType = pgEnum("activity_type", [
  "note",
  "call",
  "meeting",
  "email",
  "system",
  "stage_change",
  "file",
  "update",
])

/**
 * Polymorphic activity timeline. Auto-captured system events (created, stage
 * moved, quote sent, file attached) and manual entries (note/call/meeting/email)
 * share this table, attached to any CRM entity.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entityType: activityEntityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    type: activityType("type").notNull().default("note"),
    subject: text("subject"),
    body: text("body"),
    changes: jsonb("changes"), // [{ field, label, from, to }] — set only on type='update'
    // Standardized log fields
    outcome: text("outcome"),
    nextStep: text("next_step"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Who logged / triggered it. */
    memberId: text("member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [index("activities_entity_idx").on(t.tenantId, t.entityType, t.entityId)]
)
