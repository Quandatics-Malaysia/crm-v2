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
import { opportunities } from "./pipeline"
import { timestamps } from "./_helpers"

/**
 * Co-billing cost / purchase-order lines for a deal. Models the procurement
 * chain in an intercompany deal: the tenant (e.g. Quandatics Malaysia) buys
 * from external suppliers directly AND from a handling partner (e.g. Citrus
 * Cloud), who in turn buys from its own suppliers. Each line carries the cost
 * currency + FX rate so a USD cost reconciles to a base (MYR) amount, and the
 * funnel can show revenue vs cost vs margin.
 */
export const dealCosts = pgTable(
  "deal_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    /** Optional category/product line (License / PS / AMS / Training …). */
    category: text("category"),
    /** Optional contract year this cost belongs to (multi-year contracts). */
    contractYear: integer("contract_year"),
    /**
     * Who the PO is to, from the tenant's perspective:
     *  - `supplier`           : tenant → external supplier (direct cost)
     *  - `partner`            : tenant → handling partner (e.g. Citrus Cloud)
     *  - `partner_supplier`   : partner → its supplier (the partner's cost; informational)
     * Tenant margin counts `supplier` + `partner` outlays only.
     */
    partyKind: text("party_kind").notNull().default("supplier"),
    supplierName: text("supplier_name"),
    poNumber: text("po_number"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /** Cost in `currency`. */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** FX rate from `currency` to the base (MYR). 1 when same currency. */
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 })
      .notNull()
      .default("1"),
    /** Base-currency (MYR) cost = amount × exchangeRate, stored for easy SUM. */
    amountBase: numeric("amount_base", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("deal_costs_opportunity_idx").on(t.tenantId, t.opportunityId)]
)
