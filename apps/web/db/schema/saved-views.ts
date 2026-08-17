import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { member, organization } from "./auth"

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    listKey: text("list_key").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    sorting: jsonb("sorting").notNull(),
    visibility: jsonb("visibility").notNull(),
    pageSize: integer("page_size").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("saved_views_owner_name_uq").on(
      table.organizationId,
      table.memberId,
      table.listKey,
      table.name
    ),
    uniqueIndex("saved_views_one_default_uq")
      .on(table.organizationId, table.memberId, table.listKey)
      .where(sql`${table.isDefault} = true`),
    index("saved_views_organization_member_idx").on(
      table.organizationId,
      table.memberId
    ),
    index("saved_views_member_list_idx").on(table.memberId, table.listKey),
  ]
)

export type SavedViewRow = typeof savedViews.$inferSelect
export type NewSavedView = typeof savedViews.$inferInsert
