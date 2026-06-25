import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"
import { organization, user, member } from "./auth"
import { timestamps } from "./_helpers"

/** Append-only audit trail. Revoke UPDATE/DELETE at the DB role level. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // nullable for deployment-level events
  tenantId: text("tenant_id").references(() => organization.id, {
    onDelete: "cascade",
  }),
  actorUserId: text("actor_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  actorMemberId: text("actor_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const customFieldType = pgEnum("custom_field_type", [
  "text",
  "number",
  "date",
  "boolean",
  "select",
])

/** Per-tenant definitions that drive dynamic forms + runtime validation
 *  over the `custom_fields` jsonb columns on accounts/persons/opportunities. */
export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    dataType: customFieldType("data_type").notNull().default("text"),
    options: jsonb("options"),
    isRequired: boolean("is_required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("custom_field_defs_key_uq").on(t.tenantId, t.entityType, t.fieldKey),
  ]
)
