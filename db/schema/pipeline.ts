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
    /** Configurable entry requirements — field keys (see lib/stage-gate.ts
     *  RequirableFieldKey) that must be filled before a funnel enters this
     *  stage. Defaults seeded from the Salesforce-style map. */
    requiredFields: jsonb("required_fields")
      .$type<string[]>()
      .notNull()
      .default([]),
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
  /** QUOTED amount — synced from the primary quotation's net (display/actuals). */
  amount: numeric("amount", { precision: 14, scale: 2 }),
  /**
   * Estimated Funnel Amount — the rep's manual estimate. This is the value that
   * drives the weighted forecast (NOT the quoted amount).
   */
  estimatedAmount: numeric("estimated_amount", { precision: 14, scale: 2 }),
  /**
   * Recognized revenue percentage (0–100) the tenant keeps on this deal. For an
   * intercompany middle-man deal the tenant recognizes only its cut (e.g. 10);
   * Recognized Amount is derived as estimatedAmount × recognizedPercent / 100.
   */
  recognizedPercent: numeric("recognized_percent", { precision: 5, scale: 2 }),
  /** Free-text funnel description. */
  description: text("description"),
  /** Project / license year (e.g. 2024). */
  projectYear: integer("project_year"),
  /**
   * Intercompany deal: a partner entity handles delivery and the tenant is the
   * contracting/billing middle-man (so it recognizes only recognizedPercent).
   */
  isIntercompany: boolean("is_intercompany").notNull().default(false),
  /**
   * The partner ENTITY (another organization the user belongs to) that handles
   * delivery on an interco deal. Intercompany transfers only ever go to a
   * sibling group entity — never an external customer account.
   */
  handlingPartnerEntityId: text("handling_partner_entity_id").references(
    () => organization.id,
    { onDelete: "set null" }
  ),
  /**
   * Snapshot of the handling entity's name at write time. Display resolves the
   * LIVE organization name first (renames propagate); this is the fallback for
   * entities that no longer resolve.
   */
  handlingPartnerName: text("handling_partner_name"),
  currency: char("currency", { length: 3 }).notNull().default("MYR"),
  /**
   * Default project nature for this funnel (code from
   * tenant_settings.product_types). Acts as the deal's default and is inherited
   * by quotations on create. Nullable until the tenant assigns one.
   */
  projectNatureCode: text("product_type_code"),
  /**
   * Full set of project natures this funnel covers (a deal can span several,
   * e.g. License + Professional Services + AMS + Training). `projectNatureCode`
   * above is the PRIMARY one (first of this set) used for the project code.
   */
  projectNatures: jsonb("project_natures").$type<string[]>(),
  expectedCloseDate: date("expected_close_date"),
  actualCloseDate: date("actual_close_date"),
  status: opportunityStatus("status").notNull().default("open"),
  kivReviewDate: date("kiv_review_date"),
  lostReason: text("lost_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  customFields: jsonb("custom_fields")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
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
