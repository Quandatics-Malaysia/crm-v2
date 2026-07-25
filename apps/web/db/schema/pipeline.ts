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

/**
 * TWO-LEVEL SALES MODEL (Salesforce-aligned, see docs/superpowers/specs/
 * 2026-07-07-opportunity-funnel-remodel-design.md):
 *
 *   opportunities  (CONTAINER)  ── the pursuit: per-year id, PPVVC analysis,
 *                                  rolls up Total Estimated Funnel Amount.
 *        │ 1:N
 *   funnels        (DEAL)       ── moves through the stage ladder; owns quotes,
 *                                  dates, amounts, intercompany parties.
 *        │ N:1
 *   pipelines / pipeline_stages (TEMPLATE) ── the stage definitions.
 *
 * NOTE the deal's UI/route is `/funnel` — DB and UI now agree (deal = "Funnel").
 */

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

/** Pipeline definition/template (stage ladder). A tenant may run several. */
export const pipelines = pgTable(
  "pipelines",
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
    index("pipelines_tenant_idx").on(t.tenantId),
    uniqueIndex("pipelines_default_uq")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ]
)

/** Ordered stages within a pipeline. Canonical 8-stage set seeded per tenant. */
export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
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
    /** Whether this stage's funnels count toward the billing forecast. */
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
    unique("pipeline_stages_code_uq").on(t.pipelineId, t.code),
    unique("pipeline_stages_order_uq").on(t.pipelineId, t.sortOrder),
  ]
)

/**
 * OPPORTUNITY CONTAINER — the pursuit that rolls up one or more funnels.
 * Per-year running number → `code`/`name`; PPVVC analysis block cascades to
 * child funnels; `totalEstimatedFunnelAmount` is recomputed from the children.
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Tenant-safe composite FK -> accounts(tenant_id, id); see table config below.
    accountId: uuid("account_id").notNull(),
    primaryPersonId: uuid("primary_person_id").references(() => persons.id, {
      onDelete: "set null",
    }),
    ownerMemberId: text("owner_member_id")
      .notNull()
      .references(() => member.id, { onDelete: "restrict" }),
    /** Year the per-tenant running number is scoped to. */
    opportunityYear: integer("opportunity_year").notNull(),
    /** Running number within (tenant, year). */
    opportunityNumber: integer("opportunity_number").notNull(),
    /** Formulated id, e.g. `OPP-26-0001`. Unique per tenant. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    // PPVVC "Analysis" block (Pain / Power / Vision / Value / Control) — the
    // source of truth, cascaded to each child funnel.
    pain: text("pain"),
    power: text("power"),
    vision: text("vision"),
    value: text("value"),
    control: text("control"),
    /** Primary project nature (tenant picklist) — source of truth, cascaded to
     *  each child funnel, same pattern as PPVVC above. */
    projectNatureCode: text("project_nature_code"),
    /** Full set of project natures (first = primary). */
    projectNatures: jsonb("project_natures").$type<string[]>(),
    /** Internal delivery code (`YYYY-ENTITY-ACCOUNT-NATURE-NNN`, via
     *  nextProjectCode) generated once at container creation. Never shown in
     *  the UI — used only to prefix payment milestones' hidden `name` field. */
    projectCode: text("project_code"),
    /** Rollup = Σ child funnels' estimatedAmount. Recomputed on funnel change. */
    totalEstimatedFunnelAmount: numeric("total_estimated_funnel_amount", {
      precision: 14,
      scale: 2,
    }),
    description: text("description"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /** Salesforce "Opportunity Owner Contact" — the budget-holding contact.
     *  "Opportunity Owner Designation" is derived from this contact's
     *  `persons.title`, not stored. */
    ownerContactId: uuid("owner_contact_id").references(() => persons.id, {
      onDelete: "set null",
    }),
    ownerBudgetLimit: numeric("owner_budget_limit", { precision: 14, scale: 2 }),
    /** Salesforce "Power Sponsor Contact". Designation likewise derived. */
    powerSponsorContactId: uuid("power_sponsor_contact_id").references(
      () => persons.id,
      { onDelete: "set null" }
    ),
    powerSponsorBudgetLimit: numeric("power_sponsor_budget_limit", {
      precision: 14,
      scale: 2,
    }),
    /** Budget ceiling the deal must fit under — distinct from
     *  `totalEstimatedFunnelAmount` (a rollup of actual child-funnel estimates). */
    estimatedBudget: numeric("estimated_budget", { precision: 14, scale: 2 }),
    estimatedCloseDate: date("estimated_close_date"),
    /** Container-level renewal flag — distinct from `funnels.isRenewal`, which
     *  is per-deal. */
    isRenewal: boolean("is_renewal").notNull().default(false),
    showDashboards: boolean("show_dashboards").notNull().default(false),
    assignedPresales: text("assigned_presales"),
    competitor: text("competitor"),
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
    unique("opportunities_code_uq").on(t.tenantId, t.code),
    unique("opportunities_number_uq").on(
      t.tenantId,
      t.opportunityYear,
      t.opportunityNumber
    ),
    index("opportunities_tenant_account_idx").on(t.tenantId, t.accountId),
  ]
)

/** The DEAL that moves through a pipeline (child of an Opportunity container). */
export const funnels = pgTable(
  "funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Parent Opportunity container. Delete children before the container. */
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Auto-populated from the parent Opportunity's account. Composite FK below.
    accountId: uuid("account_id").notNull(),
    primaryPersonId: uuid("primary_person_id").references(() => persons.id, {
      onDelete: "set null",
    }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    currentStageId: uuid("current_stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    ownerMemberId: text("owner_member_id")
      .notNull()
      .references(() => member.id, { onDelete: "restrict" }),
    // references quotations (defined in quotations.ts) — FK-less to avoid an import cycle
    primaryQuotationId: uuid("primary_quotation_id"),
    /**
     * Salesforce-format quote numbering: ALL quotes on this funnel share one
     * running number (assigned once, on the funnel's first quote — global
     * max + 1 off tenant_settings.quote_next_number). NULL until the first
     * quote is created. See server/services/numbering.ts nextQuoteNumber and
     * lib/quote-number.ts formatQuoteRef.
     */
    quoteRunningNumber: integer("quote_running_number"),
    /** QUOTED amount — synced from the primary quotation's net (display/actuals). */
    amount: numeric("amount", { precision: 14, scale: 2 }),
    /**
     * Estimated Funnel Amount — the rep's manual estimate. This is the value that
     * drives the weighted forecast (NOT the quoted amount) and the container rollup.
     */
    estimatedAmount: numeric("estimated_amount", { precision: 14, scale: 2 }),
    /**
     * Recognized revenue percentage (0–100) the tenant keeps on this deal. For a
     * multi-party intercompany deal this is a CACHE derived as
     * `100 - sum(each party's effective % share of the deal)` (see
     * lib/interco-share.ts, recomputed by server/services/intercompany.ts
     * whenever intercompany_deal_parties rows change); Recognized Amount is
     * derived as estimatedAmount × recognizedPercent / 100.
     */
    recognizedPercent: numeric("recognized_percent", { precision: 5, scale: 2 }),
    /** Free-text funnel description. */
    description: text("description"),
    /** Project / license year (e.g. 2024). */
    projectYear: integer("project_year"),
    // PPVVC "Analysis" block cascaded from the parent Opportunity.
    pain: text("pain"),
    power: text("power"),
    vision: text("vision"),
    value: text("value"),
    control: text("control"),
    /** Award date (maps to Estimated Funnel Close Date on Closed Won). */
    awardDate: date("award_date"),
    /** Renewal funnel flag (renewal automation is deferred to the projects module). */
    isRenewal: boolean("is_renewal").notNull().default(false),
    /**
     * Intercompany deal: one or more partner entities handle delivery and the
     * tenant is the contracting/billing middle-man (so it recognizes only
     * recognizedPercent). Party assignments live in intercompany_deal_parties
     * (db/schema/intercompany.ts) — never an external customer account.
     */
    isIntercompany: boolean("is_intercompany").notNull().default(false),
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
    /** Salesforce "PP_Stage__c" (Procurement Process Stage) — free tenant text,
     *  same modeling as projectNatureCode (no hardcoded enum). */
    procurementStage: text("procurement_stage"),
    negotiationDone: boolean("negotiation_done").notNull().default(false),
    negotiationDate: date("negotiation_date"),
    /** Mirrors payment_milestones' identically-named/shaped columns, but for
     *  the funnel's own expected-invoice gate at stage 4A. */
    expectedInvoiceMonth: text("expected_invoice_month"),
    expectedInvoiceYear: integer("expected_invoice_year"),
    status: opportunityStatus("status").notNull().default("open"),
    kivReviewDate: date("kiv_review_date"),
    /** SF "Closed Remarks" for a KIV move — a text reason, distinct from
     *  kivReviewDate (a follow-up-by date). */
    kivReason: text("kiv_reason"),
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
      name: "funnels_tenant_account_fk",
    }).onDelete("restrict"),
    index("funnels_tenant_stage_idx").on(t.tenantId, t.currentStageId),
    index("funnels_tenant_account_idx").on(t.tenantId, t.accountId),
    index("funnels_opportunity_idx").on(t.tenantId, t.opportunityId),
  ]
)

/** Immutable log of every stage transition on a funnel. */
export const funnelStageHistory = pgTable(
  "funnel_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => pipelineStages.id, {
      onDelete: "set null",
    }),
    toStageId: uuid("to_stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
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
  (t) => [index("funnel_stage_history_idx").on(t.funnelId)]
)
