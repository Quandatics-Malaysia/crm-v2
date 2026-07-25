import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  char,
  date,
  unique,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { accounts } from "./crm"
import { funnels } from "./pipeline"
import { quotations } from "./quotations"
import { intercompanyDeals } from "./intercompany"
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
 * Project code format: {YYYY}-{EntityCode}-{AccountCode}-{ProjectNature}-{running}
 * (e.g. 2026-DEMO-ACME-WEB-001). The running number resets per year per tenant
 * (see `projectCounters`).
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
    /**
     * Snapshot of the project-nature code chosen at creation (from the tenant's
     * product_types picklist). Used as the PROJECTNATURE segment of the project
     * code so the code stays stable even if the picklist later changes.
     */
    projectNatureCode: text("product_type_code"),
    // Tenant-safe composite FK -> accounts(tenant_id, id); see table config below.
    accountId: uuid("account_id").notNull(),
    // the funnel this project was created from
    funnelId: uuid("funnel_id").references(() => funnels.id, {
      onDelete: "set null",
    }),
    // the accepted quotation it was based on
    quotationId: uuid("quotation_id").references(() => quotations.id, {
      onDelete: "set null",
    }),
    /**
     * Set when this is a HANDLING-PARTNER delivery project created from an
     * inbound intercompany deal. The mirror row is readable by this tenant via
     * the two-sided RLS policy; the origin's opportunity itself is not.
     */
    intercompanyDealId: uuid("intercompany_deal_id").references(
      () => intercompanyDeals.id,
      { onDelete: "set null" }
    ),
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

/**
 * Per-year, per-tenant running counter for project codes. `next_number` is the
 * value to assign next; it is bumped atomically (INSERT … ON CONFLICT DO UPDATE)
 * when a project code is minted, so the NNN segment resets to 1 each new year.
 */
export const projectCounters = pgTable(
  "project_counters",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })]
)
