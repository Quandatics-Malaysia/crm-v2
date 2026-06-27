import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  char,
  date,
  unique,
  foreignKey,
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
    /** "auto" (system-generated code) or "manual" (user-entered). */
    codeNature: text("code_nature").notNull().default("auto"),
    name: text("name").notNull(),
    // Tenant-safe composite FK -> accounts(tenant_id, id); see table config below.
    accountId: uuid("account_id").notNull(),
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
  (t) => [
    unique("projects_code_uq").on(t.tenantId, t.projectCode),
    foreignKey({
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "projects_tenant_account_fk",
    }).onDelete("restrict"),
  ]
)
