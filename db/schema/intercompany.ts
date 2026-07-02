import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  boolean,
  char,
  date,
  integer,
  index,
  uniqueIndex,
  timestamp,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { opportunities } from "./pipeline"
import { timestamps } from "./_helpers"

/**
 * Read-only mirror of an intercompany deal, visible to BOTH sides: the origin
 * entity (which owns and edits the source opportunity) and the handling
 * partner entity (which delivers it). Rows are upserted by the origin's sync
 * service on every relevant opportunity mutation — the partner side never
 * writes here.
 *
 * RLS is custom (see db/sql/rls.sql): SELECT allowed when the current tenant
 * is EITHER `tenant_id` (origin) or `partner_tenant_id`; writes only for the
 * origin. All display fields are snapshots so the partner needs no read into
 * the origin's RLS-protected tables (accounts, funnel stages, …).
 */
export const intercompanyDeals = pgTable(
  "intercompany_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Origin entity — the tenant that owns the source opportunity. */
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    /** Handling partner entity — the sibling org that delivers the deal. */
    partnerTenantId: text("partner_tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** End-customer account name (snapshot — accounts are origin-RLS-scoped). */
    accountName: text("account_name"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    estimatedAmount: numeric("estimated_amount", { precision: 14, scale: 2 }),
    /** Quoted net from the origin's primary quotation, when one exists. */
    quotedAmount: numeric("quoted_amount", { precision: 14, scale: 2 }),
    /** The ORIGIN's recognized cut (%); the partner's share is the remainder. */
    recognizedPercent: numeric("recognized_percent", { precision: 5, scale: 2 }),
    /** Opportunity status snapshot: open | won | lost | on_hold. */
    status: text("status").notNull().default("open"),
    stageName: text("stage_name"),
    /**
     * Origin stage's probability + forecast eligibility, snapshotted so the
     * PARTNER's forecast can weight its share of the deal without reading the
     * origin's RLS-protected funnel_stages.
     */
    stageProbability: numeric("stage_probability", { precision: 5, scale: 2 }),
    includeInForecast: boolean("include_in_forecast").notNull().default(true),
    expectedCloseDate: date("expected_close_date"),
    projectYear: integer("project_year"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("intercompany_deals_opportunity_uq").on(t.opportunityId),
    index("intercompany_deals_partner_idx").on(t.partnerTenantId),
    index("intercompany_deals_tenant_idx").on(t.tenantId),
  ]
)

export const intercompanyResponse = pgEnum("intercompany_response", [
  "accepted",
  "declined",
])

/**
 * The handling partner's response to an inbound intercompany deal — the
 * "handshake" on the assignment. Written by the PARTNER side (tenant_id here
 * is the partner tenant, matching the standard RLS write shape); the origin
 * may read it via a two-sided SELECT policy (db/sql/rls.sql). One response
 * per deal; re-responding overwrites.
 */
export const intercompanyDealResponses = pgTable(
  "intercompany_deal_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => intercompanyDeals.id, { onDelete: "cascade" }),
    /** The PARTNER tenant (the writer). */
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The origin tenant — denormalized for the origin-side read policy. */
    originTenantId: text("origin_tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    response: intercompanyResponse("response").notNull(),
    reason: text("reason"),
    respondedByMemberId: text("responded_by_member_id").references(
      () => member.id,
      { onDelete: "set null" }
    ),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("intercompany_deal_responses_deal_uq").on(t.dealId)]
)
