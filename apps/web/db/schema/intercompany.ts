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
import { funnels } from "./pipeline"
import { timestamps } from "./_helpers"

export const intercompanySharetype = pgEnum("intercompany_share_type", [
  "percent",
  "amount",
])

/**
 * A single partner entity's share of an intercompany opportunity, authored on
 * the ORIGIN side. A deal can span multiple parties (capped at
 * MAX_INTERCOMPANY_PARTIES, see lib/interco-share.ts) — each gets its own row,
 * its own share (independent, NOT a complement of the others'), and its own
 * invoicing currency/FX rate. The origin's own cut is the remainder after all
 * party shares (cached on funnels.recognized_percent).
 */
export const intercompanyDealParties = pgTable(
  "intercompany_deal_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    /** Handling partner entity — a sibling org that delivers part of the deal. */
    partnerEntityId: text("partner_entity_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    shareType: intercompanySharetype("share_type").notNull().default("amount"),
    /** Percent (0-100) when shareType='percent', absolute leg amount otherwise. */
    shareValue: numeric("share_value", { precision: 14, scale: 2 }).notNull(),
    /** The party's own invoicing currency — may differ from the deal currency. */
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /** Origin currency -> party currency rate, manually entered. Null = same currency. */
    manualFxRate: numeric("manual_fx_rate", { precision: 14, scale: 6 }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("intercompany_deal_parties_uq").on(
      t.funnelId,
      t.partnerEntityId
    ),
    index("intercompany_deal_parties_partner_idx").on(t.partnerEntityId),
  ]
)

/**
 * Read-only mirror of ONE party's slice of an intercompany deal, visible to
 * BOTH sides: the origin entity (which owns and edits the source opportunity)
 * and that handling partner entity. One row per (opportunity, partner) — a
 * deal with 3 parties has 3 mirror rows. Rows are upserted by the origin's
 * sync service on every relevant opportunity/party mutation — the partner
 * side never writes here.
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
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    /** Handling partner entity — the sibling org that delivers this slice. */
    partnerTenantId: text("partner_tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** End-customer account name (snapshot — accounts are origin-RLS-scoped). */
    accountName: text("account_name"),
    /** Deal-wide currency + basis, unchanged across a deal's mirror rows. */
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    estimatedAmount: numeric("estimated_amount", { precision: 14, scale: 2 }),
    /** Quoted net from the origin's primary quotation, when one exists. */
    quotedAmount: numeric("quoted_amount", { precision: 14, scale: 2 }),
    /** This party's own share, snapshotted from intercompany_deal_parties. */
    shareType: intercompanySharetype("share_type").notNull().default("amount"),
    shareValue: numeric("share_value", { precision: 14, scale: 2 }).notNull(),
    /** This party's own invoicing currency (may differ from `currency` above). */
    partnerCurrency: char("partner_currency", { length: 3 })
      .notNull()
      .default("MYR"),
    manualFxRate: numeric("manual_fx_rate", { precision: 14, scale: 6 }),
    /** Opportunity status snapshot: open | won | lost | on_hold. */
    status: text("status").notNull().default("open"),
    stageName: text("stage_name"),
    /**
     * Origin stage's probability + forecast eligibility, snapshotted so the
     * PARTNER's forecast can weight its share of the deal without reading the
     * origin's RLS-protected pipeline_stages.
     */
    stageProbability: numeric("stage_probability", { precision: 5, scale: 2 }),
    includeInForecast: boolean("include_in_forecast").notNull().default(true),
    expectedCloseDate: date("expected_close_date"),
    projectYear: integer("project_year"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("intercompany_deals_opportunity_partner_uq").on(
      t.funnelId,
      t.partnerTenantId
    ),
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
