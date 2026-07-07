import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  char,
  index,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { funnels } from "./pipeline"
import { timestamps } from "./_helpers"

/**
 * A year of a multi-year contract on a (typically won) deal. A 5-year deal is
 * NOT a single secured total: each year is billed separately, its price is
 * REVISABLE until that year is reached, and a year can be cancelled. So each
 * row carries its own (editable) amount + status; winning year 1 does not
 * secure years 2–5.
 */
export const contractYears = pgTable(
  "contract_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    funnelId: uuid("funnel_id")
      .notNull()
      .references(() => funnels.id, { onDelete: "cascade" }),
    /** Calendar/contract year, e.g. 2024. */
    year: integer("year").notNull(),
    /** Optional label, e.g. "Y1 — License + AMS". */
    title: text("title"),
    /** Planned billable amount for this year (revisable). */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /** planned | invoiced | cancelled — the lifecycle of one year's billing. */
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("contract_years_opportunity_idx").on(t.tenantId, t.funnelId)]
)
