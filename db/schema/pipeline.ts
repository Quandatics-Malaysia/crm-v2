import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  char,
  date,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, member } from "./auth"
import { accounts, persons } from "./crm"
import { timestamps, softDelete } from "./_helpers"

export const stageCode = pgEnum("stage_code", [
  "0e",
  "1d",
  "2c",
  "3b",
  "4a",
  "won",
  "lost",
  "kiv",
])
/** Locked semantics that drive ALL pipeline logic (never the label). */
export const stageKind = pgEnum("stage_kind", ["OPEN", "WON", "LOST", "PARKED"])
export const opportunityStatus = pgEnum("opportunity_status", [
  "open",
  "won",
  "lost",
  "on_hold",
])
export const stageChangeSource = pgEnum("stage_change_source", [
  "manual",
  "approval",
  "quote_accept",
  "reopen",
])

/** Pipeline definition/template. A tenant may run several. */
export const funnels = pgTable(
  "funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("funnels_tenant_idx").on(t.tenantId),
    uniqueIndex("funnels_default_uq")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ]
)

/** Ordered stages within a funnel. Canonical 8-stage set seeded per tenant. */
export const funnelStages = pgTable(
  "funnel_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    code: stageCode("code").notNull(),
    name: text("name").notNull(),
    probability: numeric("probability", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    kind: stageKind("kind").notNull(),
    sortOrder: integer("sort_order").notNull(),
    requiresApprovalToEnter: boolean("requires_approval_to_enter")
      .notNull()
      .default(false),
    /** Whether this stage's opportunities count toward the billing forecast. */
    includeInForecast: boolean("include_in_forecast").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("funnel_stages_code_uq").on(t.funnelId, t.code),
    unique("funnel_stages_order_uq").on(t.funnelId, t.sortOrder),
  ]
)

/** The deal that moves through a funnel (distinct from the funnel itself). */
export const opportunities = pgTable(
  "opportunities",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Tenant-safe composite FK -> accounts(tenant_id, id); see table config below.
  accountId: uuid("account_id").notNull(),
  primaryPersonId: uuid("primary_person_id").references(() => persons.id, {
    onDelete: "set null",
  }),
  funnelId: uuid("funnel_id")
    .notNull()
    .references(() => funnels.id, { onDelete: "restrict" }),
  currentStageId: uuid("current_stage_id")
    .notNull()
    .references(() => funnelStages.id, { onDelete: "restrict" }),
  ownerMemberId: text("owner_member_id")
    .notNull()
    .references(() => member.id, { onDelete: "restrict" }),
  // references quotations (defined in quotations.ts) — FK-less to avoid an import cycle
  primaryQuotationId: uuid("primary_quotation_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  currency: char("currency", { length: 3 }).notNull().default("MYR"),
  expectedCloseDate: date("expected_close_date"),
  actualCloseDate: date("actual_close_date"),
  status: opportunityStatus("status").notNull().default("open"),
  kivReviewDate: date("kiv_review_date"),
  lostReason: text("lost_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  customFields: jsonb("custom_fields").notNull().default({}),
  ...timestamps,
  ...softDelete,
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "opportunities_tenant_account_fk",
    }).onDelete("restrict"),
    index("opportunities_tenant_stage_idx").on(t.tenantId, t.currentStageId),
    index("opportunities_tenant_account_idx").on(t.tenantId, t.accountId),
  ]
)

/** Immutable log of every stage transition. */
export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").references(() => funnelStages.id, {
    onDelete: "set null",
  }),
  toStageId: uuid("to_stage_id")
    .notNull()
    .references(() => funnelStages.id, { onDelete: "restrict" }),
  changedByMemberId: text("changed_by_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  // references stage_approval_requests (approvals.ts) — FK-less to avoid an import cycle
  approvalRequestId: uuid("approval_request_id"),
  probabilityAtChange: numeric("probability_at_change", { precision: 5, scale: 2 }),
  valueAtChange: numeric("value_at_change", { precision: 14, scale: 2 }),
  source: stageChangeSource("source").notNull().default("manual"),
  /** Optional free-text reason for the move (manual moves + reopen/override). */
  reason: text("reason"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("opp_stage_history_opp_idx").on(t.opportunityId)]
)
