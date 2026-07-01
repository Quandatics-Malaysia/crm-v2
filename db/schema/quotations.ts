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
  timestamp,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "./auth"
import { opportunities } from "./pipeline"
import { products } from "./products"
import { timestamps, softDelete } from "./_helpers"

export const quotationStatus = pgEnum("quotation_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "void",
])

/** Tenant-scoped tax rates applied to quotations (services — no inventory). */
export const taxSettings = pgTable(
  "tax_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ratePercent: numeric("rate_percent", { precision: 6, scale: 3 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tax_settings_default_uq")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ]
)

/** A priced proposal under an opportunity. One opportunity → many quotations. */
export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    quoteNumber: text("quote_number").notNull(),
    version: integer("version").notNull().default(1),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: quotationStatus("status").notNull().default("draft"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /**
     * Project nature for this quote (code from tenant_settings.product_types).
     * Inherited from the funnel on create, editable thereafter, and later
     * snapshotted onto the project. Nullable until set.
     */
    projectNatureCode: text("product_type_code"),
    taxSettingId: uuid("tax_setting_id").references(() => taxSettings.id, {
      onDelete: "set null",
    }),
    taxRateSnapshot: numeric("tax_rate_snapshot", { precision: 6, scale: 3 }),
    /**
     * The tenant's tax-inclusive flag frozen onto the quote (stored totals are
     * already computed with it). Lets a non-draft quote render the correct
     * "Tax (incl./excl.)" label from its own snapshot instead of the live
     * tenant setting.
     */
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Whole-quote discount applied on top of line discounts; folded into total. */
    headerDiscount: numeric("header_discount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    discountTotal: numeric("discount_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    validUntil: date("valid_until"),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("quotations_number_uq").on(t.tenantId, t.quoteNumber)]
)

/** A single billable service line. Pure description + price — no SKU/product link. */
export const quotationLineItems = pgTable(
  "quotation_line_items",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  quotationId: uuid("quotation_id")
    .notNull()
    .references(() => quotations.id, { onDelete: "cascade" }),
  /** Optional link to the standardised product this line was created from. */
  productId: uuid("product_id").references(() => products.id, {
    onDelete: "set null",
  }),
  description: text("description").notNull(),
  /** Unit of measure snapshot (from the product, or free-text). */
  uom: text("uom"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  /**
   * Absolute per-line discount (money), subtracted from qty × unit price.
   * Physical column is the legacy name `discount_percent` (kept to avoid a
   * destructive rename) but now holds an absolute amount, widened to (14,2).
   */
  discountAmount: numeric("discount_percent", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  taxSettingId: uuid("tax_setting_id").references(() => taxSettings.id, {
    onDelete: "set null",
  }),
  lineSubtotal: numeric("line_subtotal", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  lineTax: numeric("line_tax", { precision: 14, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
  },
  (t) => [index("quotation_line_items_quotation_idx").on(t.quotationId)]
)
