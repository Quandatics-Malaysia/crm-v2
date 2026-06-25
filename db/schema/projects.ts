import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  char,
  date,
  unique,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { accounts } from "./crm"
import { opportunities } from "./pipeline"
import { quotations } from "./quotations"
import { timestamps, softDelete } from "./_helpers"

export const projectStatus = pgEnum("project_status", [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
])

/**
 * A delivery project created from a won (or any) funnel/opportunity.
 * Project code format: {YY}-{EntityCode}-{AccountCode}-{running}.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectCode: text("project_code").notNull(),
    name: text("name").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    // the funnel this project was created from
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    // the accepted quotation it was based on
    quotationId: uuid("quotation_id").references(() => quotations.id, {
      onDelete: "set null",
    }),
    ownerMemberId: text("owner_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    status: projectStatus("status").notNull().default("planning"),
    startDate: date("start_date"),
    value: numeric("value", { precision: 14, scale: 2 }),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("projects_code_uq").on(t.tenantId, t.projectCode)]
)
